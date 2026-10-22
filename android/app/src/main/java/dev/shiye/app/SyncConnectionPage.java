package dev.shiye.app;

import android.app.AlertDialog;
import android.text.InputType;
import android.view.KeyEvent;
import android.widget.*;
import org.json.JSONObject;

/** Pairing and explicit product entry. It never silently uploads the legacy local library. */
final class SyncConnectionPage implements AutoCloseable {
    private final MainActivity h;
    private final AndroidSyncTransport transport;
    private AlertDialog dialog;
    private EditText address, code, name;
    private Button save, health, pair, connect, product, computer;
    private TextView status;
    private String savedAddress;
    private boolean closing, busy;
    private long generation;

    private SyncConnectionPage(MainActivity host) throws Exception {
        h=host;transport=new AndroidSyncTransport(host);savedAddress=transport.getBaseUrl();
    }
    static void show(MainActivity host) {
        try { new SyncConnectionPage(host).open(); }
        catch(Exception error) { new AlertDialog.Builder(host).setTitle("设备同步").setMessage("安全凭据存储暂不可用，请稍后重试。本机内容仍保留。").setPositiveButton("返回",null).show(); }
    }
    private Button button(String label,Runnable run) {
        Button b=new Button(h);b.setText(label);b.setTextSize(13);b.setAllCaps(false);
        b.setTextColor(h.appTheme.accent());b.setMinHeight(h.dp(40));b.setOnClickListener(v->run.run());return b;
    }
    private EditText field(String hint,String description,int type,int limit) {
        EditText e=new EditText(h);e.setTextSize(14);e.setSingleLine(true);e.setHint(hint);e.setContentDescription(description);
        e.setInputType(type);e.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(limit)});return e;
    }
    private void open() {
        h.ownBackend(this);
        LinearLayout body=h.vertical();h.pad(body,18,8);
        body.addView(h.text("配对电脑或云端同步服务，再进入产品数据与朝花夕拾。现有日记/随想继续离线保存，未自动上传。",12,MainActivity.MUTED));
        address=field("https://同步服务地址/可选前缀/","同步服务地址",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI,2048);address.setText(savedAddress);body.addView(address,h.lp(-1,48));
        LinearLayout controls=h.horizontal();health=button("识别服务",()->request("health"));
        controls.addView(health,new LinearLayout.LayoutParams(-1,h.dp(44)));body.addView(controls);
        computer=button("填入当前电脑服务",()->{address.setText("http://100.77.215.104:18789/");status.setText("已填入文档中的电脑产品服务，请保存地址后配对。");});body.addView(computer);
        name=field("此设备名称","同步设备名称",InputType.TYPE_CLASS_TEXT,80);name.setText(android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL);body.addView(name,h.lp(-1,48));
        code=field("输入服务器生成的配对码","同步配对码",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD,128);body.addView(code,h.lp(-1,48));
        pair=button("配对此设备",()->request("pair"));body.addView(pair);
        connect=button("校验已配对连接",()->request("connect"));body.addView(connect);
        product=button("产品数据与朝花夕拾",()->{if(!address.getText().toString().trim().equals(savedAddress)){status.setText("请先保存同步地址");return;}ProductSyncPage.show(h);});body.addView(product);
        status=h.text("尚未开启内容同步",12,MainActivity.MUTED);h.pad(status,0,8);body.addView(status);
        body.addView(h.text("同步地址独立于业务服务/表情收藏；云端请使用 HTTPS。配对或连接失败不会删除本机资料。",12,MainActivity.MUTED));
        ScrollView scroll=new ScrollView(h);scroll.addView(body);
        dialog=new AlertDialog.Builder(h).setTitle("设备同步").setView(scroll).setNegativeButton("返回",null).setPositiveButton("保存地址",null).create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnKeyListener((d,key,event)->{if(key!=KeyEvent.KEYCODE_BACK)return false;if(event.getAction()==KeyEvent.ACTION_UP)back();return true;});
        dialog.setOnDismissListener(d->close());
        dialog.setOnShowListener(d->{save=dialog.getButton(AlertDialog.BUTTON_POSITIVE);save.setOnClickListener(v->saveAddress());dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(v->back());});dialog.show();
        final long token=generation;
        transport.executor().execute(()->{try{JSONObject local=transport.getStatus();h.main.post(()->{if(!alive(token))return;status.setText(local.optBoolean("paired")?"已保存此地址的设备凭据；连接需重新校验。\n尚未开启日记和消息同步。":"尚未配对；本机资料继续离线保存。");});}catch(Exception e){failed(token,e);}});
    }
    private void busy(boolean value) {
        busy=value;for(Button b:new Button[]{save,health,pair,connect,product,computer})b.setEnabled(!value);
        address.setEnabled(!value);code.setEnabled(!value);name.setEnabled(!value);
    }
    private boolean alive(long token){return !closing&&!h.destroyed&&dialog.isShowing()&&generation==token;}
    private void back(){
        if(!address.getText().toString().trim().equals(savedAddress))new AlertDialog.Builder(h).setTitle("地址尚未保存").setMessage("返回将放弃本次地址修改；已有凭据和本机资料保留。").setNegativeButton("继续调整",null).setPositiveButton("放弃修改",(d,n)->dialog.dismiss()).show();
        else dialog.dismiss();
    }
    private void saveAddress(){
        if(busy)return;final String draft=address.getText().toString();final long token=++generation;busy(true);status.setText("正在保存地址…");
        transport.executor().execute(()->{try{String normalized=transport.saveBaseUrl(draft);h.main.post(()->{if(!alive(token))return;savedAddress=normalized;address.setText(normalized);busy(false);status.setText(normalized.isEmpty()?"未配置同步服务；本机资料保留":"同步地址已保存；尚未开启内容同步");});}catch(Exception e){failed(token,e);}});
    }
    private void request(String action){
        if(busy)return;
        if(!address.getText().toString().trim().equals(savedAddress)){status.setText("请先保存同步地址");return;}
        final String pairingCode=code.getText().toString().trim(),deviceName=name.getText().toString().trim();
        if(action.equals("pair")&&(pairingCode.isEmpty()||deviceName.isEmpty())){status.setText("请输入配对码和设备名称");return;}
        final long token=++generation;busy(true);status.setText(action.equals("pair")?"正在配对此设备…":"正在校验同步服务…");
        transport.executor().execute(()->{try{
            JSONObject result=action.equals("pair")?transport.pair(pairingCode,deviceName):action.equals("health")?transport.health():transport.connect();
            h.main.post(()->{if(!alive(token))return;busy(false);if(action.equals("pair"))code.setText("");String id=result.optString("libraryId","");status.setText((action.equals("health")?"已识别同步服务":action.equals("pair")?"设备配对已确认":"已配对连接校验成功")+(id.isEmpty()?"":"\n资料库："+id)+"\n尚未开启日记和消息同步");});
        }catch(Exception e){failed(token,e);}});
    }
    private void failed(long token,Exception error){h.main.post(()->{if(!alive(token))return;busy(false);String message=error instanceof AndroidSyncTransport.SyncException?error.getMessage():"同步连接未完成，请检查地址、配对码或认证状态后重试。";status.setText(message+"\n本机内容保留；尚未开启内容同步。");});}
    @Override public void close(){if(closing)return;closing=true;generation++;if(code!=null)code.setText("");transport.cancel();transport.close();h.releaseBackend(this);if(dialog!=null&&dialog.isShowing())dialog.dismiss();}
}
