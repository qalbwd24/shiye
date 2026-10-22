package dev.shiye.app;

import android.app.AlertDialog;
import android.text.InputType;
import android.view.KeyEvent;
import android.widget.*;
import org.json.*;
import java.util.concurrent.*;

/** Native connection/catalog page. Network work never occupies the diary save queue. */
final class BackendServicesPage {
    private final MainActivity h;
    private final BackendServices backend;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private AlertDialog dialog, detail;
    private EditText address;
    private TextView status;
    private TextView stickerStatus;
    private Button stickerConnect;
    private LinearLayout results;
    private Button save, refresh;
    private String savedAddress;
    private boolean busy, closing, hasCatalog;
    private long generation;

    private BackendServicesPage(MainActivity host) {
        h=host; backend=new BackendServices(host); savedAddress=backend.getBaseUrl();
    }
    static void show(MainActivity host) { new BackendServicesPage(host).open(); }
    private Button button(String label,Runnable action) {
        Button b=new Button(h);b.setText(label);b.setTextSize(14);b.setAllCaps(false);
        b.setTextColor(h.appTheme.accent());b.setMinHeight(h.dp(48));b.setOnClickListener(v->action.run());return b;
    }

    private void open() {
        LinearLayout body=h.vertical();h.pad(body,18,8);
        TextView intro=h.text("内容保存在本机；连接后可查看服务器提供的服务。",13,MainActivity.MUTED);
        body.addView(intro);
        body.addView(button("设备同步与配对",()->SyncConnectionPage.show(h)));
        address=new EditText(h);address.setSingleLine(true);address.setTextSize(14);
        address.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2048)});
        address.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://服务地址；留空使用离线模式");address.setText(savedAddress);
        address.setContentDescription("服务器地址");body.addView(address,h.lp(-1,54));
        LinearLayout buttons=h.horizontal();save=button("保存地址",()->saveAddress(false));
        refresh=button("发现服务",()->saveAddress(true));
        buttons.addView(save,new LinearLayout.LayoutParams(0,h.dp(48),1));
        buttons.addView(refresh,new LinearLayout.LayoutParams(0,h.dp(48),1));body.addView(buttons);
        status=h.text(savedAddress.isEmpty()?"离线模式":"尚未读取服务",13,MainActivity.MUTED);h.pad(status,0,10);body.addView(status);
        results=h.vertical();body.addView(results);
        TextView stickerTitle=h.text("表情包收藏",15,MainActivity.INK);h.bold(stickerTitle);h.pad(stickerTitle,0,10);body.addView(stickerTitle);
        body.addView(h.text("连接后合并本机和服务端收藏，原件仍保留在本机。离线时本机表情继续可用。",12,MainActivity.MUTED));
        stickerConnect=button(h.stickerServices.isEnabled()?"断开收藏服务":"连接收藏服务",this::toggleStickers);
        stickerConnect.setContentDescription("连接表情包收藏服务");body.addView(stickerConnect);
        stickerStatus=h.text(h.stickerServices.isEnabled()?"已启用收藏连接":"未连接；仅使用本机收藏",12,MainActivity.MUTED);body.addView(stickerStatus);
        TextView help=h.text("电脑服务需先完成连接配置；云端使用 HTTPS 地址。",12,MainActivity.MUTED);
        h.pad(help,0,12);body.addView(help);
        ScrollView scroll=new ScrollView(h);scroll.addView(body);
        dialog=new AlertDialog.Builder(h).setTitle("服务连接").setView(scroll).setNegativeButton("返回",null).create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnKeyListener((d,key,event)->{if(key!=KeyEvent.KEYCODE_BACK)return false;if(event.getAction()==KeyEvent.ACTION_UP)back();return true;});
        dialog.setOnDismissListener(d->{closing=true;generation++;if(detail!=null)detail.dismiss();network.shutdownNow();});
        dialog.setOnShowListener(d->{dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(v->back());loadCache();});
        dialog.show();
    }
    private void toggleStickers(){
        if(busy)return;
        if(!address.getText().toString().trim().equals(savedAddress)){stickerStatus.setText("请先保存上方服务地址");return;}
        final boolean next=!h.stickerServices.isEnabled();setBusy(true);stickerConnect.setEnabled(false);stickerStatus.setText(next?"正在连接收藏服务…":"正在断开…");
        h.stickerServices.setEnabled(next,(reply,error)->{
            if(closing||h.destroyed||!dialog.isShowing())return;
            setBusy(false);stickerConnect.setEnabled(true);stickerConnect.setText(h.stickerServices.isEnabled()?"断开收藏服务":"连接收藏服务");
            stickerStatus.setText(error==null?(next?"收藏服务已连接；本机收藏会在后台同步":"已断开；本机收藏与原件保留"):error.getMessage());
        });
    }
    private boolean alive(long token) { return !closing&&!h.destroyed&&dialog.isShowing()&&generation==token; }
    private void setBusy(boolean value) { busy=value;save.setEnabled(!value);refresh.setEnabled(!value);address.setEnabled(!value); }
    private void back() {
        if(!address.getText().toString().trim().equals(savedAddress)) {
            new AlertDialog.Builder(h).setTitle("地址尚未保存").setMessage("返回将放弃这次地址修改，已有内容和连接设置不变。")
                .setNegativeButton("继续调整",null).setPositiveButton("放弃修改",(d,n)->dialog.dismiss()).show();
        } else dialog.dismiss();
    }
    private void loadCache() {
        final long token=++generation;
        network.execute(()->{JSONObject cached=backend.getCachedDiscovery();h.main.post(()->{if(alive(token)&&cached!=null)render(cached,true);});});
    }
    private void saveAddress(boolean discover) {
        if(busy)return;
        final String draft=address.getText().toString();final long token=++generation;
        setBusy(true);status.setText(discover?"正在连接服务…":"正在保存地址…");
        network.execute(()->{
            try {
                String prior=backend.getBaseUrl();String normalized=backend.saveBaseUrl(draft);
                if(!normalized.equals(prior))h.main.post(()->h.stickerServices.addressChanged());
                JSONObject cached=backend.getCachedDiscovery();
                h.main.post(()->{if(!alive(token))return;savedAddress=normalized;address.setText(normalized);results.removeAllViews();hasCatalog=false;if(cached!=null)render(cached,true);});
                JSONObject response=discover&&!normalized.isEmpty()?backend.discover():null;
                h.main.post(()->{if(!alive(token))return;setBusy(false);if(response!=null)render(response,false);else status.setText(normalized.isEmpty()?"离线模式；本地内容继续保留":"地址已保存，点击“发现服务”读取可用服务");});
            }catch(Exception failure){h.main.post(()->{if(!alive(token))return;setBusy(false);status.setText((failure instanceof BackendServices.ServiceException?failure.getMessage():"服务读取失败，请重试")+(hasCatalog?"\n下方保留上次服务快照":""));});}
        });
    }
    private void label(String value) { TextView text=h.text(value,14,MainActivity.INK);h.bold(text);h.pad(text,0,10);results.addView(text); }
    private void render(JSONObject value,boolean cached) {
        results.removeAllViews();
        status.setText(cached?"上次成功读取的服务快照；点击发现服务更新":"已连接；服务目录已更新");
        JSONObject catalog=value.optJSONObject("catalog");if(catalog==null)return;
        hasCatalog=true;
        JSONArray providers=catalog.optJSONArray("providers"),instances=catalog.optJSONArray("instances");
        label("可用服务");
        if(providers!=null)for(int i=0;i<Math.min(64,providers.length());i++) {
            JSONObject provider=providers.optJSONObject(i);if(provider==null)continue;
            String id=provider.optString("id");TextView text=h.text(provider.optString("name",id)+(id.equals("revisit")?" · 可查看":" · 暂未支持"),14,MainActivity.INK);h.pad(text,0,6);results.addView(text);
        }
        label("独立实例");
        if(instances==null||instances.length()==0)results.addView(h.text("暂无独立实例。此处不会自动新建或绑定会话。",13,MainActivity.MUTED));
        else for(int i=0;i<Math.min(128,instances.length());i++) {
            JSONObject item=instances.optJSONObject(i);if(item==null)continue;
            String id=item.optString("id"),name=item.optString("name","未命名实例");
            Button button=button(name,()->readInstance(id,name));
            button.setSingleLine(true);button.setEllipsize(android.text.TextUtils.TruncateAt.END);
            button.setContentDescription("查看实例状态："+name);
            button.setTextSize(14);button.setEnabled("revisit".equals(item.optString("providerId")));
            results.addView(button,h.lp(-1,-2));
        }
        JSONObject legacy=catalog.optJSONObject("legacy");
        if(legacy!=null&&legacy.optBoolean("compatible")) {
            label("已有回看");results.addView(h.text("原有规则和历史继续保留。",13,MainActivity.MUTED));
        }
    }
    private void readInstance(String id,String name) {
        if(busy)return;final long token=++generation;setBusy(true);status.setText("正在读取实例状态…");
        network.execute(()->{
            try {
                JSONObject reply=backend.instanceRequest(id,"status",new JSONObject());
                JSONObject config=reply.optJSONObject("config");
                String text="实例："+name+"\n";
                if(config!=null)text+=(config.optBoolean("enabled")?"已启用":"未启用")+"\n模式："+(config.optString("mode").equals("daily-random")?"每日随机":"间隔回看")+"\n每日时间："+config.optString("dailyTime","—")+"\n时区："+config.optString("timeZone","—");
                final String display=text+"\n\n这里只读取状态，不改变规则或推进服务器进度。";
                h.main.post(()->{if(!alive(token))return;setBusy(false);status.setText("实例状态已更新");detail=new AlertDialog.Builder(h).setTitle("朝花夕拾状态").setMessage(display).setPositiveButton("返回",null).show();});
            }catch(Exception failure){h.main.post(()->{if(!alive(token))return;setBusy(false);status.setText(failure instanceof BackendServices.ServiceException?failure.getMessage():"实例读取失败，请重试");});}
        });
    }
}
