package dev.shiye.app;

import android.app.AlertDialog;
import android.widget.*;
import org.json.JSONObject;

/** Product protocol entry. Read-only reception is explicitly distinct from legacy UI migration. */
final class ProductSyncPage implements AutoCloseable {
    private final MainActivity h;
    private final AndroidSyncTransport transport;
    private final ProductSyncCoordinator coordinator;
    private AlertDialog dialog;
    private TextView status;
    private Button catalog,receive,revisit,sync,enable,disable,select;
    private boolean closed,busy;
    private long generation;
    private boolean polling,showSyncState=true;
    private final Runnable poll=()->pollStatus();
    private ProductSyncPage(MainActivity host){h=host;transport=new AndroidSyncTransport(host);coordinator=new ProductSyncCoordinator(host.store,transport);}
    static void show(MainActivity host){new ProductSyncPage(host).open();}
    private Button button(String label,String action){Button b=new Button(h);b.setText(label);b.setAllCaps(false);b.setTextSize(13);b.setMinHeight(h.dp(40));b.setOnClickListener(v->request(action));return b;}
    private void open(){
        h.ownBackend(this);
        LinearLayout body=h.vertical();h.pad(body,18,8);
        body.addView(h.text("使用已配对的设备同步地址。先核对产品能力，再接收增量；接收后的完整信封保存在本机。",12,MainActivity.MUTED));
        catalog=button("检查产品服务","catalog");receive=button("接收服务更新","receive");revisit=button("朝花夕拾服务状态","revisit");body.addView(catalog);body.addView(receive);body.addView(revisit);
        sync=button("立即同步已加入的数据","productSyncRun");
        select=button("将本机已保存思绪加入同步","productSyncQueueLocal");
        enable=button("开启前台自动同步","productSyncEnable");
        disable=button("暂停自动同步","productSyncDisable");
        body.addView(select);body.addView(sync);body.addView(enable);body.addView(disable);
        status=h.text("正在读取本机状态…",12,MainActivity.MUTED);h.pad(status,0,8);body.addView(status);
        body.addView(h.text("先接收服务更新，再将本机已保存的思绪加入同步（每次最多100篇，空草稿保留在本机）。开启自动同步后，已加入的数据在本应用前台时自动接收和发送，网络失败保留待发内容并稍后重试。旧随想与尚未转换的旧日记仍留在原库。",12,MainActivity.MUTED));
        ScrollView scroll=new ScrollView(h);scroll.addView(body);
        dialog=new AlertDialog.Builder(h).setTitle("产品数据与朝花夕拾").setView(scroll).setNegativeButton("返回",null).create();dialog.setCanceledOnTouchOutside(false);
        dialog.setOnDismissListener(d->close());dialog.show();
        pollStatus();
    }
    private boolean alive(long token){return !closed&&!h.destroyed&&dialog.isShowing()&&generation==token;}
    private String describe(JSONObject value){String phase=value.optString("phase");String state=phase.equals("idle")?"本轮完成":phase.equals("checkpoint")?"还有后续内容":phase.equals("queued")?"已排队":phase.equals("receiving")?"接收中":phase.equals("sending")?"发送中":phase.equals("blocked")?"等待处理":"已暂停";
        long next=value.optLong("nextAttemptAt");if(next>System.currentTimeMillis())state+="，约"+Math.max(1,(next-System.currentTimeMillis())/1000)+"秒后继续";
        return "本机接收记录："+value.optLong("records")+"\n待处理："+value.optLong("pending")+"　冲突："+value.optLong("conflicts")+"\n"+(value.optBoolean("initialized")?"初次快照已完整接收":"初次快照尚未完成")+"\n自动同步："+(value.optBoolean("enabled")?"已开启（应用前台）":"已暂停")+"\n当前状态："+state+(value.optString("error").isEmpty()?"":"\n"+explain(value.optString("error")))+(value.optString("mediaError").isEmpty()?"":"\n部分原件待重试，本机正文已保留");}
    private String explain(String code){switch(code){case "SYNC_AUTH_REQUIRED":return "设备尚未配对或凭据失效，请重新配对后继续";case "SYNC_LIBRARY_MISMATCH":case "SYNC_EPOCH_MISMATCH":return "服务端资料库已改变，请核对连接；本机内容保留";case "SYNC_NETWORK":case "SYNC_TIMEOUT":case "SYNC_OFFLINE":return "网络暂不可用，本机内容和待同步记录保留";case "INITIAL_RECEIVE_REQUIRED":return "请先接收一次服务更新，再加入本机思绪";case "LOCAL_ORIGINAL_REQUIRED":return "部分附件原件尚未在本机就绪，请保留原记录后重试";default:return "本次同步未完成，请检查连接或稍后重试";}}
    private void pollStatus(){if(closed||polling)return;polling=true;long token=generation;transport.executor().execute(()->{try{JSONObject value=h.productBridge.status();h.main.post(()->{polling=false;if(!alive(token))return;if(showSyncState&&!busy)status.setText(describe(value));if(!busy){boolean running=value.optBoolean("running");for(Button b:new Button[]{catalog,receive,revisit,sync,enable,select})b.setEnabled(!running);disable.setEnabled(true);}h.main.postDelayed(poll,value.optBoolean("running")?400:1500);});}catch(Exception e){h.main.post(()->{polling=false;if(!closed)h.main.postDelayed(poll,1500);});}});}
    private void busy(boolean value){busy=value;for(Button b:new Button[]{catalog,receive,revisit,sync,enable,disable,select})b.setEnabled(!value);}
    private void request(String action){if(busy)return;showSyncState=action.startsWith("productSync");long token=++generation;busy(true);status.setText("正在处理…");transport.executor().execute(()->{try{
        JSONObject result=action.startsWith("productSync")?h.productBridge.handle(action,new JSONObject(),null):action.equals("receive")?coordinator.receive():action.equals("revisit")?coordinator.revisitStatus():coordinator.catalog();
        h.main.post(()->{if(!alive(token))return;busy(false);
            if(action.startsWith("productSync")){status.setText(describe(result)+(result.optJSONObject("selection")==null?"":"\n本次加入："+result.optJSONObject("selection").optInt("queuedEntries")+"篇，仍可加入："+result.optJSONObject("selection").optInt("remainingEntries")+"篇"));}
            else if(action.equals("receive"))status.setText(describe(result)+"\n本次接收："+result.optInt("received")+(result.optBoolean("hasMore")?"，仍有后续页，可继续接收":""));
            else if(action.equals("catalog"))status.setText("产品服务 schema "+result.optInt("schema")+" 已核对\n资料库："+result.optString("libraryId")+"\n网络可用不等于现有日记已启用同步。");
            else {JSONObject config=result.optJSONObject("config");status.setText("已连接库级朝花夕拾服务\n"+(config==null?"规则尚不可用":"当前模式："+config.optString("mode")+"\n时区："+config.optString("timeZone"))+"\n实例/收件与评论不能用演示会话冒充。");}
            h.main.removeCallbacks(poll);h.main.postDelayed(poll,1000);
        });
    }catch(Exception error){failed(token,error);}});}
    private void failed(long token,Exception error){h.main.post(()->{if(!alive(token))return;busy(false);showSyncState=false;h.main.removeCallbacks(poll);h.main.postDelayed(poll,1500);String text=error instanceof AndroidSyncTransport.SyncException?error.getMessage():error instanceof ProductRepository.RepositoryException?((ProductRepository.RepositoryException)error).code:"处理未完成，请检查连接后重试";status.setText((error.getMessage()!=null&&error.getMessage().matches("[A-Z][A-Z0-9_]+")?explain(error.getMessage()):text)+"\n本机资料与已提交的接收游标保留。");});}
    @Override public void close(){if(closed)return;closed=true;generation++;h.main.removeCallbacks(poll);coordinator.close();transport.close();h.releaseBackend(this);if(dialog!=null&&dialog.isShowing())dialog.dismiss();}
}
