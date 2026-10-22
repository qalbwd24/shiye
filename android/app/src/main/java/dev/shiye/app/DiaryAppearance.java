package dev.shiye.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

/** Diary-only appearance. Files and preferences never enter the content/media store. */
final class DiaryAppearance {
    /** The dialog title and Save/Cancel stay visible as the appearance controls scroll. */
    private static final class SettingsScroll extends ScrollView {
        SettingsScroll(MainActivity host){super(host);}
        @Override protected void onMeasure(int widthSpec,int heightSpec){
            android.util.DisplayMetrics metrics=getResources().getDisplayMetrics();
            int cap=Math.max((int)(160*metrics.density),Math.min((int)(metrics.heightPixels*.68f),
                    metrics.heightPixels-(int)(168*metrics.density)));
            int size=View.MeasureSpec.getMode(heightSpec)==View.MeasureSpec.UNSPECIFIED?cap:
                    Math.min(cap,View.MeasureSpec.getSize(heightSpec));
            super.onMeasure(widthSpec,View.MeasureSpec.makeMeasureSpec(size,View.MeasureSpec.AT_MOST));
        }
    }
    static final int PICK_REQUEST = 204;
    static final int PICK_LIST_REQUEST = 207;
    static final int PICK_STARTUP_REQUEST = 212;
    private static final String KEY = "android-diary-appearance-v1";
    private final MainActivity h;
    private final boolean listScope;
    private final boolean startupScope;
    private final String preferenceKey, folderName, urlPrefix;
    private final int pickRequest;
    private JSONObject saved, draft;
    private EditText dividerColorInput;
    private View dividerColorPreview;
    private String pausedDividerColorText;
    private AlertDialog dialog;
    private TextView source, opacityLabel, blurLabel;
    private LinearLayout settingsPage;
    private FrameLayout startupPreview;
    private TextView startupPreviewLabel;
    private Bitmap previewBitmap;
    private String previewPath="";
    private String previewPendingPath="";
    private int previewGeneration;
    private boolean publishing, pendingPicker;
    private boolean pauseOnDismiss;
    private JSONObject pausedDraft;
    private final Set<File> draftFiles=new HashSet<>();

    DiaryAppearance(MainActivity host) { this(host,"writing"); }
    DiaryAppearance(MainActivity host,boolean forList) { this(host,forList?"list":"writing"); }
    DiaryAppearance(MainActivity host,String scope) {
        if(!Arrays.asList("writing","list","startup").contains(scope))throw new IllegalArgumentException("Unknown appearance scope");
        h=host;listScope="list".equals(scope);startupScope="startup".equals(scope);
        preferenceKey=listScope?"android-diary-list-appearance-v1":startupScope?"android-startup-appearance-v1":KEY;
        folderName=listScope?"appearance-list":startupScope?"appearance-startup":"appearance";
        urlPrefix="/"+folderName+"/";
        pickRequest=listScope?PICK_LIST_REQUEST:startupScope?PICK_STARTUP_REQUEST:PICK_REQUEST;
        saved=read();
    }
    private JSONObject defaults() { return MainActivity.obj("backgroundMode","sky","background",JSONObject.NULL,"blur",0,"theme","light","veil","none"); }
    JSONObject current() { return effective(saved); }
    /** Percent of the row background only; wallpaper opacity and page veil are independent. */
    static double listRowOpacity(JSONObject value) {
        Object raw=value==null?null:value.opt("listRowOpacity");
        if(!(raw instanceof Number))return 0;
        double percent=((Number)raw).doubleValue();
        return Double.isNaN(percent)||Double.isInfinite(percent)?0:Math.max(0,Math.min(100,percent));
    }
    static final String DEFAULT_LIST_DIVIDER_COLOR="#d7eaf5";
    /** The list owns a separate six-digit opaque sRGB color; reading never rewrites old values. */
    static String normalizeListDividerColor(Object value) {
        if(!(value instanceof String)||!((String)value).matches("#[0-9a-fA-F]{6}"))return null;
        return ((String)value).toLowerCase(Locale.ROOT);
    }
    static String listDividerColor(JSONObject value) {
        String color=normalizeListDividerColor(value==null?null:value.opt("listDividerColor"));
        return color==null?DEFAULT_LIST_DIVIDER_COLOR:color;
    }
    static int listDividerArgb(JSONObject value) {
        return 0xff000000|Integer.parseInt(listDividerColor(value).substring(1),16);
    }
    private void changeListDividerColor(CharSequence value) {
        if(!listScope||draft==null)return;
        String color=normalizeListDividerColor(value==null?null:value.toString());
        if(color==null){if(dividerColorInput!=null)dividerColorInput.setError("请输入#RRGGBB色值");return;}
        if(dividerColorInput!=null)dividerColorInput.setError(null);
        try{draft.put("listDividerColor",color);paint();}catch(Exception e){h.error(e);}
    }
    private boolean validListDividerInput() {
        if(!listScope||dividerColorInput==null)return true;
        if(normalizeListDividerColor(dividerColorInput.getText().toString())!=null)return true;
        dividerColorInput.setError("请输入#RRGGBB色值");h.toast("分割线颜色未完成，请输入#RRGGBB或恢复默认");return false;
    }
    private void addListDividerControl(LinearLayout page) {
        TextView title=h.text("列表分割线颜色",13,MainActivity.INK);title.setPadding(0,h.dp(8),0,0);page.addView(title);
        LinearLayout controls=h.horizontal();
        dividerColorInput=new EditText(h);dividerColorInput.setSingleLine(true);dividerColorInput.setMinimumHeight(h.dp(44));
        dividerColorInput.setContentDescription("思绪列表分割线颜色，#RRGGBB");dividerColorInput.setHint("#RRGGBB");
        dividerColorInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        String initial=pausedDividerColorText==null?listDividerColor(draft):pausedDividerColorText;pausedDividerColorText=null;
        dividerColorInput.setText(initial);
        if(normalizeListDividerColor(initial)==null)dividerColorInput.setError("请输入#RRGGBB色值");
        dividerColorInput.addTextChangedListener(new android.text.TextWatcher(){
            public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void onTextChanged(CharSequence s,int start,int before,int count){}
            public void afterTextChanged(android.text.Editable value){changeListDividerColor(value);}
        });
        controls.addView(dividerColorInput,new LinearLayout.LayoutParams(0,-2,1));
        Button reset=new Button(h);reset.setText("默认浅蓝");reset.setMinimumHeight(h.dp(44));
        reset.setOnClickListener(v->dividerColorInput.setText(DEFAULT_LIST_DIVIDER_COLOR));
        controls.addView(reset,new LinearLayout.LayoutParams(-2,-2));page.addView(controls);
        dividerColorPreview=new View(h);dividerColorPreview.setContentDescription("分割线颜色预览");
        page.addView(dividerColorPreview,new LinearLayout.LayoutParams(-1,Math.max(1,h.dp(1))));
    }
    private JSONObject effective(JSONObject value) {
        JSONObject result=copy(value);
        if(h.appTheme!=null)try{result.put("theme",h.appTheme.mode());}catch(Exception e){throw new IllegalStateException(e);}
        return result;
    }
    private boolean isDark() { return "dark".equals(effective(draft==null?saved:draft).optString("theme")); }
    private static JSONObject copy(JSONObject value) { try{return new JSONObject(value.toString());}catch(Exception e){throw new IllegalStateException(e);} }
    private JSONObject read() {
        try {
            JSONObject value=new JSONObject(h.getPreferences(0).getString(preferenceKey,defaults().toString()));
            // Legacy custom wallpaper had an implicit light veil. Preserve it
            // until the user chooses a different option; new installs start clear.
            if(!Arrays.asList("light","dark").contains(value.optString("theme")))value.put("theme","light");
            if(!Arrays.asList("none","light","dark").contains(value.optString("veil")))value.put("veil","light");
            String mode=value.optString("backgroundMode");
            if(!Arrays.asList("sky","custom","none").contains(mode))return defaults();
            JSONObject b=value.optJSONObject("background");
            if(mode.equals("custom")&&(b==null||fileForPath(b.optString("url"))==null))return defaults();
            return value;
        } catch(Exception e) { return defaults(); }
    }
    File fileForPath(String path) {
        if(path==null||!path.matches(java.util.regex.Pattern.quote(urlPrefix)+"[a-f0-9-]{36}\\.(jpg|png|webp|gif)"))return null;
        File f=new File(new File(h.getFilesDir(),folderName),path.substring(urlPrefix.length()));
        return f.isFile()?f:null;
    }
    private void preview(JSONObject original) {
        JSONObject value=effective(original);
        if(startupScope)return;
        if(listScope) { if(h.diaryListPage!=null)h.diaryListPage.applyAppearance(value);return; }
        if(h.web!=null&&h.screen.equals("editor")) {
            h.applyDiaryChrome(value);
            h.web.evaluateJavascript("window.shiyeApplyAppearance?.("+value.toString()+")",null);
        }
    }
    private void discardCreated(File file) {
        File folder=new File(h.getFilesDir(),folderName);
        if(file!=null&&file.getParentFile().equals(folder)&&file.getName().matches("[a-f0-9-]{36}\\.(jpg|png|webp|gif)"))file.delete();
    }
    private void discardDraftFiles(File keep) {
        for(File file:new ArrayList<>(draftFiles))if(!file.equals(keep))discardCreated(file);
        draftFiles.clear();if(keep!=null)draftFiles.add(keep);
    }
    private void paint() {
        if(draft==null)return;
        String mode=draft.optString("backgroundMode");
        source.setText(mode.equals("custom")?"自选壁纸":mode.equals("none")?"纯色背景":"默认天空蓝");
        boolean dark=isDark();
        tint(settingsPage,dark);
        if(dialog!=null&&dialog.getWindow()!=null){
            dialog.getWindow().setBackgroundDrawable(h.shape(dark?0xff1d2935:0xfff4f9fd,20));
            View decor=dialog.getWindow().getDecorView();tint(decor,dark);
        }
        if(listScope&&dividerColorPreview!=null)dividerColorPreview.setBackgroundColor(listDividerArgb(draft));
        if(startupScope)paintStartupPreview();
        preview(draft);
    }
    private void paintStartupPreview(){
        if(startupPreview==null||draft==null)return;
        JSONObject appearance=effective(draft),background=draft.optJSONObject("background");
        File file="custom".equals(draft.optString("backgroundMode"))&&background!=null?fileForPath(background.optString("url")):null;
        String path=file==null?"":file.getAbsolutePath();
        if(!path.equals(previewPath)){
            previewPath=path;previewPendingPath="";previewGeneration++;
            if(previewBitmap!=null){Bitmap old=previewBitmap;previewBitmap=null;startupPreview.setBackground(null);old.recycle();}
        }
        startupPreview.setBackground(new NativeWallpaperDrawable(appearance,previewBitmap));
        startupPreviewLabel.setTextColor(isDark()?0xffffffff:0xff10283a);
        startupPreviewLabel.setShadowLayer(h.dp(2),0,h.dp(1),isDark()?0xff061420:0xb3ffffff);
        if(path.isEmpty()||previewBitmap!=null||path.equals(previewPendingPath))return;
        previewPendingPath=path;
        final int generation=previewGeneration;final JSONObject target=draft;
        h.io.execute(()->{
            Bitmap decoded=null;
            try{
                BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(path,bounds);
                if(bounds.outWidth>0&&bounds.outHeight>0){
                    int sample=1;while(Math.max(bounds.outWidth,bounds.outHeight)/sample>1024)sample*=2;
                    BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=sample;decoded=BitmapFactory.decodeFile(path,options);
                }
            }catch(Exception ignored){}
            final Bitmap ready=decoded;
            h.main.post(()->{
                if(draft!=target||generation!=previewGeneration||startupPreview==null||dialog==null||!dialog.isShowing()){
                    if(ready!=null)ready.recycle();return;
                }
                previewPendingPath="";previewBitmap=ready;startupPreview.setBackground(new NativeWallpaperDrawable(effective(draft),previewBitmap));
            });
        });
    }
    private void tint(View view,boolean dark) {
        if(view==null)return;
        if(view instanceof TextView)((TextView)view).setTextColor(view instanceof Button?(dark?0xff9ed5fb:MainActivity.ACCENT):(dark?0xffe9f1f7:MainActivity.INK));
        if(view instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)view;for(int i=0;i<group.getChildCount();i++)tint(group.getChildAt(i),dark);}
    }
    void show() {
        if(dialog!=null&&dialog.isShowing())return;
        if(publishing){h.toast("壁纸仍在保存，请稍后打开");return;}
        draft=copy(pausedDraft==null?saved:pausedDraft);pausedDraft=null;
        ScrollView scroll=new SettingsScroll(h);
        LinearLayout page=h.vertical();settingsPage=page;h.pad(page,22,10);scroll.addView(page);
        page.addView(h.text("主题跟随全局外观；此处仅调整这张壁纸。",12,MainActivity.MUTED));
        if(startupScope){
            startupPreview=new FrameLayout(h);
            LinearLayout.LayoutParams previewLP=new LinearLayout.LayoutParams(-1,h.dp(160));previewLP.topMargin=h.dp(10);previewLP.bottomMargin=h.dp(8);
            startupPreviewLabel=h.text("拾页 · 启动预览",17,MainActivity.INK);h.bold(startupPreviewLabel);startupPreviewLabel.setGravity(Gravity.CENTER);
            startupPreview.addView(startupPreviewLabel,new FrameLayout.LayoutParams(-1,-1));page.addView(startupPreview,previewLP);
        }
        if(listScope) {
            TextView rowLabel=h.text("",13,MainActivity.INK);page.addView(rowLabel);
            SeekBar rowOpacity=new ScrollSafeSeekBar(h);rowOpacity.setMax(100);rowOpacity.setMinimumHeight(h.dp(44));
            rowOpacity.setContentDescription("普通行背景不透明度");
            int rowValue=(int)Math.round(listRowOpacity(draft));rowOpacity.setProgress(rowValue);
            rowLabel.setText("普通行背景不透明度 "+rowValue+"%");
            page.addView(h.text("0%透出壁纸，100%为实色；置顶保留独立深色膜。",12,MainActivity.MUTED));
            rowOpacity.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
                public void onProgressChanged(SeekBar b,int p,boolean user){
                    rowLabel.setText("普通行背景不透明度 "+p+"%");
                    if(user)try{draft.put("listRowOpacity",p);paint();}catch(Exception e){h.error(e);}
                }
                public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}
            });page.addView(rowOpacity);
            addListDividerControl(page);
        }
        addPageOption(page,"壁纸遮罩",new String[]{"无膜","浅色膜","深色膜"},new String[]{"none","light","dark"},"veil");
        page.addView(h.text("无膜＋不透明度100%显示原图；主题与遮罩可分别选择。",12,MainActivity.MUTED));
        source=h.text("",15,MainActivity.INK);source.setPadding(0,h.dp(16),0,h.dp(6));page.addView(source);
        Button choose=new Button(h);choose.setText("选择／更换壁纸");choose.setMinimumHeight(h.dp(44));choose.setOnClickListener(v->pick());page.addView(choose);
        LinearLayout modes=h.horizontal();
        for(String mode:new String[]{"sky","none"}) {
            Button button=new Button(h);button.setText(mode.equals("sky")?"天空蓝":"无壁纸");button.setMinimumHeight(h.dp(44));
            button.setOnClickListener(v->{try{draft.put("backgroundMode",mode);draft.put("background",JSONObject.NULL);paint();}catch(Exception e){h.error(e);}});
            modes.addView(button,new LinearLayout.LayoutParams(0,-2,1));
        }page.addView(modes);
        opacityLabel=h.text("",13,MainActivity.INK);page.addView(opacityLabel);
        SeekBar opacity=new ScrollSafeSeekBar(h);opacity.setMax(100);opacity.setMinimumHeight(h.dp(44));opacity.setContentDescription("壁纸不透明度");
        int opacityValue=(int)Math.round(background().optDouble("opacity",1)*100);
        opacity.setProgress(opacityValue);opacityLabel.setText("壁纸不透明度 "+opacityValue+"%");
        opacity.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            public void onProgressChanged(SeekBar b,int p,boolean user){opacityLabel.setText("壁纸不透明度 "+p+"%");if(user)changeBackground("opacity",p/100d);}
            public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}
        });page.addView(opacity);
        addSpinner(page,"填充方式",new String[]{"铺满","完整显示","平铺"},new String[]{"cover","contain","tile"},"fill");
        addSpinner(page,"位置",new String[]{"居中","顶部","底部","左侧","右侧"},new String[]{"center","top","bottom","left","right"},"position");
        if(!listScope&&!startupScope) {
        blurLabel=h.text("模糊 "+draft.optInt("blur",0)+"px",13,MainActivity.INK);page.addView(blurLabel);
        SeekBar blur=new ScrollSafeSeekBar(h);blur.setMax(20);blur.setProgress(draft.optInt("blur",0));blur.setMinimumHeight(h.dp(44));blur.setContentDescription("壁纸模糊");
        blur.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
            public void onProgressChanged(SeekBar b,int p,boolean user){blurLabel.setText("模糊 "+p+"px");if(user)try{draft.put("blur",p);paint();}catch(Exception e){h.error(e);}}
            public void onStartTrackingTouch(SeekBar b){}public void onStopTrackingTouch(SeekBar b){}
        });page.addView(blur);
        }
        TextView hint=h.text(startupScope?"仅用于应用打开、内容加载期间；页面就绪便结束，不额外延时。背景只存当前设备。":"壁纸单独保存，不会成为日记附件。调整即时预览，保存后记住。",12,MainActivity.MUTED);hint.setPadding(0,h.dp(10),0,h.dp(12));page.addView(hint);
        dialog=new AlertDialog.Builder(h,isDark()?android.R.style.Theme_Material_Dialog_Alert:android.R.style.Theme_Material_Light_Dialog_Alert).setTitle(startupScope?"启动过渡背景":listScope?"思绪列表背景":"思绪外观").setView(scroll).setNegativeButton("取消",null).setPositiveButton("保存",null).create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setOnDismissListener(d->{
            previewGeneration++;previewPendingPath="";if(previewBitmap!=null){Bitmap old=previewBitmap;previewBitmap=null;if(startupPreview!=null)startupPreview.setBackground(null);old.recycle();}startupPreview=null;startupPreviewLabel=null;previewPath="";
            if(pauseOnDismiss){pauseOnDismiss=false;pausedDraft=draft==null?null:copy(draft);pausedDividerColorText=listScope&&dividerColorInput!=null?dividerColorInput.getText().toString():null;preview(saved);draft=null;dividerColorInput=null;dividerColorPreview=null;pendingPicker=false;return;}
            if(!publishing)preview(saved);JSONObject background=saved.optJSONObject("background");File keep=background==null?null:fileForPath(background.optString("url"));discardDraftFiles(keep);draftFiles.clear();draft=null;dividerColorInput=null;dividerColorPreview=null;pausedDividerColorText=null;pendingPicker=false;
        });
        dialog.setOnShowListener(d->{
            dialog.getWindow().setGravity(Gravity.CENTER);
            dialog.getWindow().setLayout(Math.min(h.getResources().getDisplayMetrics().widthPixels-h.dp(32),h.dp(560)),WindowManager.LayoutParams.WRAP_CONTENT);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setMinHeight(h.dp(44));
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setMinHeight(h.dp(44));
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->save());paint();
        });dialog.show();
    }
    /** Leave a module without applying its appearance draft or reopening a dialog on return. */
    void dismissForModuleChange(){if(dialog!=null&&dialog.isShowing()){pauseOnDismiss=true;dialog.dismiss();}}
    private JSONObject background() {
        JSONObject b=draft.optJSONObject("background");
        return b==null?MainActivity.obj("fill","cover","position","center","opacity",1):b;
    }
    private void addPageOption(LinearLayout page,String label,String[] labels,String[] values,String key) {
        TextView title=h.text(label,13,MainActivity.INK);title.setPadding(0,h.dp(8),0,0);page.addView(title);
        Spinner spinner=new Spinner(h);spinner.setContentDescription(label);spinner.setMinimumHeight(h.dp(44));
        spinner.setAdapter(new ArrayAdapter<String>(h,android.R.layout.simple_spinner_dropdown_item,labels));
        String selected=draft.optString(key,values[0]);for(int i=0;i<values.length;i++)if(values[i].equals(selected))spinner.setSelection(i);
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            public void onNothingSelected(AdapterView<?> p){}
            public void onItemSelected(AdapterView<?> p,View v,int at,long id){if(draft!=null)try{if(!values[at].equals(draft.optString(key))){draft.put(key,values[at]);paint();}else tint(p,isDark());}catch(Exception e){h.error(e);}}
        });page.addView(spinner);
    }
    private void changeBackground(String key,Object value) {
        try { JSONObject b=background();b.put(key,value);draft.put("background",b);paint(); }catch(Exception e){h.error(e);}
    }
    private void addSpinner(LinearLayout page,String label,String[] labels,String[] values,String key) {
        TextView title=h.text(label,13,MainActivity.INK);title.setPadding(0,h.dp(10),0,0);page.addView(title);
        Spinner spinner=new Spinner(h);spinner.setContentDescription(label);spinner.setMinimumHeight(h.dp(44));spinner.setAdapter(new ArrayAdapter<String>(h,android.R.layout.simple_spinner_dropdown_item,labels));
        String selected=background().optString(key,values[0]);for(int i=0;i<values.length;i++)if(values[i].equals(selected))spinner.setSelection(i);
        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onNothingSelected(AdapterView<?> p){}public void onItemSelected(AdapterView<?> p,View v,int at,long id){if(draft!=null)changeBackground(key,values[at]);}});page.addView(spinner);
    }
    private void save() {
        if(publishing||draft==null)return;
        if(!validListDividerInput())return;
        if(pendingPicker){h.toast("壁纸仍在导入，请稍后保存");return;}
        JSONObject next=copy(draft);
        String submittedDivider=listScope?normalizeListDividerColor(next.opt("listDividerColor")):null;
        if(submittedDivider!=null)try{next.put("listDividerColor",submittedDivider);}catch(Exception e){h.error(e);return;}
        JSONObject selectedBackground=next.optJSONObject("background");
        if(next.optString("backgroundMode").equals("custom")&&(selectedBackground==null||fileForPath(selectedBackground.optString("url"))==null)){h.toast("请先选择可用壁纸");return;}
        publishing=true;dialog.setCancelable(false);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
        h.io.execute(()->{
            boolean ok=h.getPreferences(0).edit().putString(preferenceKey,next.toString()).commit();
            h.main.post(()->{if(h.destroyed)return;if(ok){saved=next;pausedDraft=null;pausedDividerColorText=null;preview(saved);if(dialog!=null&&dialog.isShowing())dialog.dismiss();
                    JSONObject background=saved.optJSONObject("background");File keep=background==null?null:fileForPath(background.optString("url"));discardDraftFiles(keep);draftFiles.clear();publishing=false;
                    h.toast(startupScope?"启动过渡背景已保存":listScope?"思绪列表背景已保存":"思绪外观已保存");}
                else{publishing=false;if(dialog!=null&&dialog.isShowing()){dialog.setCancelable(true);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);}else pausedDraft=next;h.toast("外观未保存，请重试");}});
        });
    }
    private void pick() {
        if(pendingPicker||publishing)return;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");
        try{pendingPicker=true;h.startActivityForResult(intent,pickRequest);}catch(Exception e){pendingPicker=false;h.error(e);}
    }
    void picked(Uri uri) {
        if(uri==null||draft==null){pendingPicker=false;return;}
        final JSONObject target=draft;
        source.setText("正在导入壁纸…");
        h.io.execute(()->{
            File created=null;
            try{
                File folder=new File(h.getFilesDir(),folderName);if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("无法创建壁纸目录");
                String mime=h.getContentResolver().getType(uri),ext="image/png".equals(mime)?"png":"image/webp".equals(mime)?"webp":"image/gif".equals(mime)?"gif":"jpg";
                File file=new File(folder,UUID.randomUUID().toString()+"."+ext);
                created=file;
                long size=0;try(InputStream in=h.getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(file)){
                    if(in==null)throw new IOException("无法读取壁纸");byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){size+=n;if(size>20L*1024*1024)throw new IOException("壁纸最大20MiB");out.write(bytes,0,n);}out.getFD().sync();
                }
                BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),options);
                if(options.outWidth<1||options.outHeight<1||options.outWidth>32768||options.outHeight>32768||!Arrays.asList("image/jpeg","image/png","image/webp","image/gif").contains(options.outMimeType))throw new IOException("请选择有效的PNG/JPG/WebP/GIF壁纸");
                h.main.post(()->{if(h.destroyed||draft!=target){discardCreated(file);return;}pendingPicker=false;try{discardDraftFiles(null);draftFiles.add(file);JSONObject b=background();b.put("url",urlPrefix+file.getName());draft.put("background",b).put("backgroundMode","custom");paint();}catch(Exception e){discardCreated(file);h.error(e);}});
            }catch(Exception e){discardCreated(created);h.main.post(()->{if(draft==target){pendingPicker=false;if(!h.destroyed)h.error(e);}});}
        });
    }
}
