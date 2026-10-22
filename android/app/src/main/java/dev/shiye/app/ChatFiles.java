package dev.shiye.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import org.json.JSONObject;
import java.io.*;
import java.util.UUID;

/** Bounded, sequential Blob transfer; only the selected document URI receives exported bytes. */
final class ChatFiles {
    static final int SAVE_REQUEST = 205;
    private final MainActivity h;
    private File file;
    private volatile String token;
    private String name, mime, action, pendingId;
    private long expected, written;
    private volatile WebMessagePort pendingPort, ownerPort;
    ChatFiles(MainActivity host) { h=host; }
    void reply(WebMessagePort port,String id,JSONObject value,Exception failure) {
        JSONObject answer=MainActivity.obj("type","files-result","requestId",id,"ok",failure==null,
            "value",value==null?JSONObject.NULL:value,"error",failure==null?"":failure.getMessage());
        h.main.post(()->{try{port.postMessage(new WebMessage(answer.toString()));}catch(Exception ignored){}});
    }
    void handle(WebMessagePort port,JSONObject q) {
        final String id=q.optString("requestId"), op=q.optString("type");
        if(h.destroyed||h.io.isShutdown()||id.isEmpty()||id.length()>80)return;
        h.io.execute(()->{try{
            JSONObject v=q.optJSONObject("value");if(v==null)throw new IOException("缺少文件参数");
            JSONObject result=new JSONObject();
            if(op.equals("file-begin")) {
                if(file!=null)throw new IOException("请先完成当前文件保存");
                long size=v.optLong("size",-1);if(size<0||size>64L*1024*1024)throw new IOException("文件需小于64MB");
                name=v.optString("name","附件").replaceAll("[\\\\/\\p{Cntrl}]","_");
                if(name.isEmpty())name="附件";if(name.length()>160)name=name.substring(0,160);
                mime=v.optString("mimeType","application/octet-stream");
                if(!mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+"))mime="application/octet-stream";
                String requestedToken=v.optString("token");if(!requestedToken.matches("[a-f0-9-]{36}"))throw new IOException("无效文件会话");
                UUID.fromString(requestedToken);action=v.optString("action","save");expected=size;written=0;token=requestedToken;
                File dir=new File(h.getCacheDir(),"chat-exports");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法准备文件");
                file=File.createTempFile("export-",".part",dir);ownerPort=port;result.put("token",token);
            } else {
                if(file==null||ownerPort!=port||!v.optString("token").equals(token))throw new IOException("文件保存会话已失效");
                if(op.equals("file-chunk")) {
                    if(pendingPort!=null||v.optLong("offset",-1)!=written)throw new IOException("文件顺序无效");
                    String data=v.optString("data");if(data.length()>262144)throw new IOException("文件片段过大");
                    byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
                    if(written+bytes.length>expected)throw new IOException("文件长度不一致");
                    try(OutputStream out=new FileOutputStream(file,true)){out.write(bytes);}written+=bytes.length;result.put("written",written);
                } else if(op.equals("file-cancel")) { clear();result.put("cancelled",true); }
                else if(op.equals("file-finish")) {
                    if(written!=expected||pendingPort!=null)throw new IOException("文件尚未完整准备");
                    pendingPort=port;pendingId=id;final String activeToken=token;
                    h.main.post(()->{if(h.destroyed||h.isFinishing()||h.telegram==null||!h.telegram.ownsPort(port)||ownerPort!=port||!activeToken.equals(token)||pendingPort!=port)return;try{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE,name);h.startActivityForResult(intent,SAVE_REQUEST);}
                        catch(Exception e){finish(null,e);}});return;
                } else throw new IOException("未知文件操作");
            }
            reply(port,id,result,null);
        }catch(Exception e){reply(port,id,null,e);}});
    }
    void selected(int result,Intent data) { if(pendingPort==null){if(result==Activity.RESULT_OK)h.toast("保存已中断，请重新保存该文件");return;}finish(result==Activity.RESULT_OK&&data!=null?data.getData():null,null); }
    private void finish(Uri uri,Exception initial) {
        if(h.destroyed||h.io.isShutdown())return;
        h.io.execute(()->{
            WebMessagePort port=pendingPort;String id=pendingId;
            if(port==null)return;
            Exception failure=initial;boolean saved=false;String openMime=mime;boolean open="open".equals(action);
            if(uri!=null&&failure==null)try(InputStream in=new FileInputStream(file);OutputStream out=h.getContentResolver().openOutputStream(uri,"wt")){
                if(out==null)throw new IOException("无法写入所选文件");byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);out.flush();saved=true;
            }catch(Exception e){failure=e;saved=false;}
            clear();reply(port,id,MainActivity.obj("saved",saved,"cancelled",uri==null&&failure==null),failure);
            if(saved&&open)h.main.post(()->{if(h.destroyed)return;try{h.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,openMime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));}catch(Exception e){h.toast("已保存，设备上没有可打开此文件的应用");}});
        });
    }
    private void clear(){if(file!=null)file.delete();file=null;token=null;pendingPort=null;pendingId=null;ownerPort=null;}
    void cancelOwner(WebMessagePort port){h.io.execute(()->{if(ownerPort==port)clear();});}
    void dispose(){h.io.execute(this::clear);}
}
