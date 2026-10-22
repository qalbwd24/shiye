package dev.shiye.app;

import android.content.SharedPreferences;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BiConsumer;
import org.json.JSONObject;

/** App-owned opt-in and port ownership around the fixed native collection client. */
final class StickerServicesBridge {
    private final MainActivity h;
    final AndroidStickerServices services;
    private final BackendServices backend;
    private final SharedPreferences prefs;
    private final AtomicLong generation=new AtomicLong();
    private volatile boolean enabled,closed;
    StickerServicesBridge(MainActivity host){
        h=host;backend=new BackendServices(host);services=new AndroidStickerServices(host,backend);
        prefs=host.getSharedPreferences("android_sticker_connection_v1",0);
        enabled=prefs.getBoolean("enabled",false);
    }
    boolean isEnabled(){return enabled;}
    void setEnabled(boolean next,BiConsumer<JSONObject,Exception> done){
        final long token=generation.incrementAndGet();
        if(!next){enabled=false;services.disconnect();}
        services.executor().execute(()->{
            JSONObject result=null;Exception failure=null;
            try{
                if(next)services.connect();
                if(closed||generation.get()!=token)return;
                if(!prefs.edit().putBoolean("enabled",next).commit())throw new Exception("收藏连接设置未保存，请重试");
                enabled=next;result=stateValue("");
            }catch(Exception e){failure=e;if(next){enabled=false;services.disconnect();}}
            final JSONObject answer=result;final Exception error=failure;
            h.main.post(()->{if(closed||h.destroyed||generation.get()!=token)return;notifyChanged();done.accept(answer,error);});
        });
    }
    void addressChanged(){generation.incrementAndGet();services.disconnect();notifyChanged();}
    private JSONObject stateValue(String error){return MainActivity.obj("enabled",enabled,"connected",enabled&&services.isConnected(),
        "baseUrl",backend.getBaseUrl(),"scopeBaseUrl",services.getPinnedBaseUrl(),"error",error);}
    private void notifyChanged(){if(h.telegram!=null)h.telegram.stickerStateChanged();}
    void handle(WebMessagePort owner,JSONObject message){
        final String requestId=message.optString("requestId"),type=message.optString("type");
        if(closed||requestId.isEmpty()||requestId.length()>80)return;
        services.executor().execute(()->{
            JSONObject result=null;Exception failure=null;
            try{
                if(closed)throw new Exception("收藏连接已关闭");
                JSONObject value=message.optJSONObject("value");if(value==null)value=new JSONObject();
                if(type.equals("sticker-state")){
                    String error="";
                    if(enabled&&!services.isConnected())try{services.connect();}catch(Exception e){error=e.getMessage();}
                    result=stateValue(error);
                }else{
                    if(!enabled||!services.isConnected())throw new Exception("收藏服务未连接，本机表情仍可使用");
                    if(type.equals("sticker-request"))result=services.request(value.optString("action"),value.optJSONObject("payload"));
                    else if(type.equals("sticker-upload-begin"))result=services.uploadBegin(owner,value);
                    else if(type.equals("sticker-upload-chunk"))result=services.uploadAppend(owner,value.optString("token"),value.optLong("offset",-1),value.optString("data"));
                    else if(type.equals("sticker-upload-finish"))result=services.uploadFinish(owner,value.optString("token"));
                    else if(type.equals("sticker-upload-cancel"))result=services.uploadCancel(owner,value.optString("token"));
                    else throw new Exception("不支持的收藏操作");
                }
            }catch(Exception e){failure=e;}
            reply(owner,requestId,result,failure);
        });
    }
    private void reply(WebMessagePort owner,String requestId,JSONObject value,Exception error){
        JSONObject answer=MainActivity.obj("type","sticker-result","requestId",requestId,"ok",error==null,
            "value",value==null?JSONObject.NULL:value,"error",error==null?"":error.getMessage());
        h.main.post(()->{if(closed||h.destroyed||h.telegram==null||!h.telegram.ownsPort(owner))return;
            try{owner.postMessage(new WebMessage(answer.toString()));}catch(Exception ignored){}
        });
    }
    void cancelOwner(WebMessagePort owner){if(!closed)services.executor().execute(()->services.cancelOwner(owner));}
    void close(){closed=true;generation.incrementAndGet();services.close();}
}
