package dev.shiye.app;

import android.app.*;
import android.content.*;
import android.content.pm.ApplicationInfo;
import android.database.Cursor;
import android.graphics.*;
import android.graphics.drawable.*;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.text.*;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.zip.*;

/** Offline prototype. Native diary navigation/chat + shared richdoc editor, one SQLite authority. */
public final class MainActivity extends Activity {
  @Override protected void attachBaseContext(Context base){
    // This compact writing UI owns its typography; leave the device font setting untouched.
    android.content.res.Configuration config=new android.content.res.Configuration(base.getResources().getConfiguration());
    config.fontScale=1f;
    super.attachBaseContext(base.createConfigurationContext(config));
  }
  static final int BG=0xffb6def0, INK=0xff111827, MUTED=0xff475569, ACCENT=0xff327db2, PALE=0xffd9edf9, LINE=0xffb5d2e3;
  static final String ORIGIN="https://appassets.androidplatform.net";
  final ExecutorService io=Executors.newSingleThreadExecutor();
  final Handler main=new Handler(Looper.getMainLooper());
  final Map<String,Anchor> anchors=new HashMap<>();
  final Set<AutoCloseable> backendPages=new HashSet<>();
  void ownBackend(AutoCloseable page){backendPages.add(page);}
  void releaseBackend(AutoCloseable page){backendPages.remove(page);}
  void closeBackendPages(){AutoCloseable[] pages=backendPages.toArray(new AutoCloseable[0]);backendPages.clear();for(AutoCloseable page:pages)try{page.close();}catch(Exception ignored){}}
  LocalStore store;
  ProductUiBridge productBridge;
  DiaryAppearance appearance, diaryListAppearance, startupAppearance;
  GlobalAppearance appTheme;
  JSONObject diaryChrome;
  AppSettings appSettings;
  ChatFiles chatFiles;
  ChatBackgrounds chatBackgrounds;
  private long chatListBackdropGeneration;
  private String chatListBackdropPath="";
  private Bitmap chatListBackdropBitmap;
  private JSONObject chatListBackdropRecord;
  private NativeWallpaperDrawable chatListBackdropDrawable;
  private boolean chatListBackdropDark;
  StickerServicesBridge stickerServices;
  DiaryListPage diaryListPage;
  DiaryListPage cachedDiaryListPage;
  final NavigationImeTransition navigationTransition=new NavigationImeTransition(this);
  volatile boolean imeVisible;
  boolean navigationRequested, telegramConversationOpen, telegramDark, qqBlueChrome;
  volatile int statusInsetPx;
  LinearLayout root;
  JSONObject catalog=new JSONObject();
  JSONArray messages=new JSONArray();
  int tab=0;
  String screen="home", category="", search="", roomId="", entryId="", replyId="", animateMessageId="";
  ListView messageList;
  ChatAdapter chatAdapter;
  EditText composer;
  LinearLayout replyBar;
  View sendButton;
  WebView web;
  TelegramFrontend telegram;
  ValueCallback<Uri[]> telegramPhotos;
  boolean legacyChat=false, openingEntry=false;
  View navigationBar;
  int editorReturnTab=0;
  WebMessagePort nativePort;
  boolean restoringDraft=false, sending=false, destroyed=false;
  Runnable draftTask;
  Consumer<JSONObject> imageResult;
  Consumer<JSONArray> imagesResult;
  String pickerOwner="";
  boolean imageOriginal=true;
  DiaryLocation diaryLocation;
  DiaryScrollCapture diaryCapture;
  DiaryDocumentActions diaryDocumentActions;
  Dialog diaryImageViewer;
  Bitmap editorPreviewBitmap;
  ImageView editorPreview;
  Runnable editorRevealTimeout;
  int editorSceneGeneration;
  FrameLayout startupOverlay;
  Bitmap startupBitmap;
  int startupGeneration;
  final StartupTransitionState startupState=new StartupTransitionState();
  TextView startupLabel, startupFallback;
  String telegramRoomId="", startupRoomId="";
  WebMessagePort locationReplyPort;
  long locationReplyId;
  String locationEntryId="";
  static class Anchor { String id; int offset; boolean bottom; Anchor(String i,int o,boolean b){id=i;offset=o;bottom=b;} }
  interface Work<T>{T run() throws Exception;}
  static JSONObject obj(Object... fields){JSONObject o=new JSONObject();try{for(int i=0;i<fields.length;i+=2)o.put((String)fields[i],fields[i+1]);}catch(JSONException e){throw new IllegalArgumentException(e);}return o;}
  static JSONObject at(JSONArray a,int i){JSONObject o=a.optJSONObject(i);return o==null?new JSONObject():o;}
  int dp(float v){return Math.round(v*getResources().getDisplayMetrics().density);}
  TextView text(String s,float size,int color){TextView v=new TextView(this);v.setText(s);v.setTextSize(size);v.setTextColor(appTheme==null?color:appTheme.textColor(color));v.setFontFeatureSettings("kern");return v;}
  LinearLayout vertical(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);return v;}
  LinearLayout horizontal(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.HORIZONTAL);v.setGravity(Gravity.CENTER_VERTICAL);return v;}
  LinearLayout.LayoutParams lp(int w,int h){return new LinearLayout.LayoutParams(w<0?w:dp(w),h<0?h:dp(h));}
  GradientDrawable shape(int color,float radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
  void pad(View v,int x,int y){v.setPadding(dp(x),dp(y),dp(x),dp(y));}
  void bold(TextView v){v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));}
  void rule(LinearLayout parent){View line=new View(this);line.setBackgroundColor(LINE);parent.addView(line,new LinearLayout.LayoutParams(-1,dp(1)));}
  void toast(String s){Toast.makeText(this,s,Toast.LENGTH_SHORT).show();}
  void error(Throwable e){String s=e.getMessage();toast(s==null?"没有完成，请重试":s);}
  <T> void work(Work<T> job,Consumer<T> done){io.execute(()->{try{T result=job.run();main.post(()->{if(!destroyed)done.accept(result);});}catch(Exception e){main.post(()->{if(!destroyed)error(e);});}});}
  void call(JSONObject q,Consumer<JSONObject> done){work(()->store.dispatch(q),done);}
  String nowDay(){return new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT).format(new Date());}
  String day(String raw){return raw!=null&&raw.length()>=10?raw.substring(0,10):nowDay();}
  String clock(String raw){try{return new SimpleDateFormat("HH:mm",Locale.CHINA).format(java.time.Instant.parse(raw).toEpochMilli());}catch(Exception e){return raw!=null&&raw.length()>15?raw.substring(11,16):"";}}
  String displayDate(String raw){try{java.time.LocalDate d=java.time.LocalDate.parse(day(raw));return d.getMonthValue()+"月"+d.getDayOfMonth()+"日";}catch(Exception e){return "今天";}}

  @Override public void onCreate(Bundle saved){setTheme("dark".equals(getPreferences(0).getString(GlobalAppearance.KEY,"light"))?R.style.AppThemeDark:R.style.AppTheme);super.onCreate(saved);
    try { store=new LocalStore(this); productBridge=new ProductUiBridge(this); productBridge.setChangeListener(()->{if(telegram!=null)telegram.productChanged();}); appTheme=new GlobalAppearance(this); appearance=new DiaryAppearance(this); diaryListAppearance=new DiaryAppearance(this,true); startupAppearance=new DiaryAppearance(this,"startup"); appSettings=new AppSettings(this); chatFiles=new ChatFiles(this); chatBackgrounds=new ChatBackgrounds(this); stickerServices=new StickerServicesBridge(this); } catch(Exception failure) { throw new IllegalStateException("本地记录库未能打开",failure); }
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
    getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    root=vertical();root.setBackgroundColor(BG);setContentView(root);
    root.setOnApplyWindowInsetsListener((v,insets)->{
      boolean previousIme=imeVisible;
      if(Build.VERSION.SDK_INT>=30){
        android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars());android.graphics.Insets k=insets.getInsets(WindowInsets.Type.ime());
        imeVisible=insets.isVisible(WindowInsets.Type.ime())&&k.bottom>b.bottom;
        syncBottomNavigation(previousIme!=imeVisible);
        if(telegram!=null&&previousIme!=imeVisible)telegram.updateImeVisible(imeVisible);
        statusInsetPx=b.top;
        root.setPadding(b.left,drawsBehindStatusBar()?0:b.top,b.right,Math.max(b.bottom,k.bottom));
        if(diaryListPage!=null&&screen.equals("home")&&tab==0)diaryListPage.page.setPadding(0,b.top,0,0);
        if(telegram!=null)telegram.updateStatusInset(b.top);
        applyDiaryInsets(b.top);
        updateChatListWallpaperGeometry();
      }else{
        imeVisible=insets.getSystemWindowInsetBottom()>dp(120);
        syncBottomNavigation(previousIme!=imeVisible);
        if(telegram!=null&&previousIme!=imeVisible)telegram.updateImeVisible(imeVisible);
        statusInsetPx=insets.getSystemWindowInsetTop();
        root.setPadding(insets.getSystemWindowInsetLeft(),drawsBehindStatusBar()?0:statusInsetPx,insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
        if(diaryListPage!=null&&screen.equals("home")&&tab==0)diaryListPage.page.setPadding(0,statusInsetPx,0,0);
        if(telegram!=null)telegram.updateStatusInset(statusInsetPx);
        applyDiaryInsets(insets.getSystemWindowInsetTop());
        updateChatListWallpaperGeometry();
      }
      return insets;
    });
    root.requestApplyInsets();
    showStartupTransition();
    tab=saved!=null?saved.getInt("tab",1):1;
    String oldEntry=saved!=null?saved.getString("entryId",""):getPreferences(0).getString("entryId","");
    String oldRoom=saved!=null?saved.getString("roomId",""):getPreferences(0).getString("roomId","");
    String oldTelegramRoom=saved!=null?saved.getString("telegramRoomId",""):getPreferences(0).getString("telegramRoomId","");
    String oldScreen=saved!=null?saved.getString("screen",""):getPreferences(0).getString("screen","");
    call(obj("op","bootstrap"),value->{catalog=value;String mode=getPreferences(0).getString("startup","last");
      if(saved!=null){if(!oldEntry.isEmpty())openEditor(oldEntry);else if(!oldRoom.isEmpty())openRoom(oldRoom);else if(oldScreen.equals("telegram"))openTelegram(oldTelegramRoom);else showHome();}
      else if(mode.equals("write"))startNewDiary("");
      else if(mode.equals("last")&&!oldEntry.isEmpty())openEditor(oldEntry);
      else if(mode.equals("last")&&!oldRoom.isEmpty())openRoom(oldRoom);
      else if(mode.equals("last")&&oldScreen.equals("telegram"))openTelegram(oldTelegramRoom);
      else {tab=mode.equals("diary")?0:mode.equals("chats")?1:getPreferences(0).getInt("tab",1);showHome();}
    });
  }
  void remember(){getPreferences(0).edit().putInt("tab",tab).putString("screen",screen).putString("entryId",screen.equals("editor")?entryId:"").putString("roomId",screen.equals("room")?roomId:"").putString("telegramRoomId",screen.equals("telegram")?telegramRoomId:"").apply();}
  void showStartupTransition(){
    final int generation=++startupGeneration;
    FrameLayout layer=new FrameLayout(this);startupOverlay=layer;
    TextView label=startupLabel=text("拾页",32,appTheme.isDark()?Color.WHITE:ACCENT);label.setGravity(Gravity.CENTER);
    layer.addView(label,new FrameLayout.LayoutParams(-1,-1));
    startupFallback=text("打开列表",16,appTheme.isDark()?Color.WHITE:ACCENT);startupFallback.setGravity(Gravity.CENTER);
    startupFallback.setVisibility(View.GONE);
    FrameLayout.LayoutParams fallbackLP=new FrameLayout.LayoutParams(-1,dp(64),Gravity.BOTTOM);
    layer.addView(startupFallback,fallbackLP);
    startupFallback.setOnClickListener(v->continueStartupToList());
    ((FrameLayout)findViewById(android.R.id.content)).addView(layer,new FrameLayout.LayoutParams(-1,-1));
    loadStartupWallpaper(layer,generation);
    armStartupDeadline(layer,generation);
  }
  void loadStartupWallpaper(FrameLayout layer,int generation){
    final int imageTicket=startupState.beginImage();
    final JSONObject value=startupAppearance.current();
    layer.setBackground(new NativeWallpaperDrawable(value,null));
    JSONObject background=value.optJSONObject("background");
    boolean custom="custom".equals(value.optString("backgroundMode"));
    File file=custom&&background!=null?startupAppearance.fileForPath(background.optString("url")):null;
    if(file==null){
      if(custom)toast("启动背景未能读取，已使用默认背景；可在设置重新选择");
      startupWallpaperSettled(layer,generation,imageTicket,value,null);return;
    }
    new Thread(()->{
      Bitmap decoded=null;
      try{BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),bounds);
        if(bounds.outWidth>0&&bounds.outHeight>0){BitmapFactory.Options options=new BitmapFactory.Options();int sample=1;
          while(Math.max(bounds.outWidth,bounds.outHeight)/sample>2048)sample*=2;
          options.inSampleSize=sample;decoded=BitmapFactory.decodeFile(file.getPath(),options);}
      }catch(Exception|OutOfMemoryError ignored){}
      final Bitmap ready=decoded;
      main.post(()->{if(startupOverlay!=layer||generation!=startupGeneration||!startupState.acceptsImage(imageTicket)){if(ready!=null)ready.recycle();return;}
        if(ready==null)toast("启动背景未能显示，已使用默认背景；可在设置重新选择");
        startupWallpaperSettled(layer,generation,imageTicket,value,ready);
      });
    },"shiye-startup-wallpaper").start();
  }
  void startupWallpaperSettled(FrameLayout layer,int generation,int imageTicket,JSONObject value,Bitmap bitmap){
    startupBitmap=bitmap;layer.setBackground(new NativeWallpaperDrawable(value,bitmap));
    startupState.imageSettled(imageTicket);
    // Observe an actual draw of this background before allowing a ready target to remove it.
    layer.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener(){
      boolean drawn;
      @Override public void onDraw(){if(drawn)return;drawn=true;
        layer.post(()->{if(layer.getViewTreeObserver().isAlive())layer.getViewTreeObserver().removeOnDrawListener(this);
          if(startupOverlay==layer&&generation==startupGeneration){startupState.imagePresented(imageTicket);maybeFinishStartup();}});
      }
    });layer.invalidate();
  }
  void armStartupDeadline(FrameLayout layer,int generation){
    main.postDelayed(()->{if(startupOverlay!=layer||generation!=startupGeneration)return;
      if(!startupState.imageReady()){
        // A stuck decoder cannot keep the app covered; invalidate its late completion.
        int imageTicket=startupState.beginImage();
        toast("启动背景加载未完成，已使用默认背景；可点击重试");
        startupWallpaperSettled(layer,generation,imageTicket,new JSONObject(),null);
      }
      startupLabel.setText("页面尚未准备好\n点击重试");
      startupFallback.setVisibility(View.VISIBLE);
      layer.setOnClickListener(v->retryStartupTransition());
    },12000);
  }
  void retryStartupTransition(){
    FrameLayout layer=startupOverlay;if(layer==null)return;
    // Advance the generation so queued old target/timeout/decode callbacks are inert.
    int generation=++startupGeneration;startupState.beginTarget();
    layer.setOnClickListener(null);startupLabel.setText("正在继续加载…");startupFallback.setVisibility(View.GONE);
    if(startupBitmap!=null){layer.setBackground(null);startupBitmap.recycle();startupBitmap=null;}
    loadStartupWallpaper(layer,generation);armStartupDeadline(layer,generation);
    if(screen.equals("telegram")&&telegram!=null)telegram.retryStartup();
    else if(screen.equals("editor")&&web!=null){editorSceneGeneration++;web.reload();}
    else if(screen.equals("home")&&tab==0&&diaryListPage!=null){diaryListPage.retryStartupWallpaper();startupNativeReady();}
    else showHome();
  }
  void continueStartupToList(){
    if(screen.equals("telegram")&&telegram!=null){telegramRestoreFailed();retryStartupTransition();return;}
    if(screen.equals("home")&&tab==0&&diaryListPage!=null){
      startupState.beginTarget();diaryListPage.useStartupWallpaperFallback();startupNativeReady();return;
    }
    if(catalog!=null){tab=0;showHome();}
  }
  void maybeFinishStartup(){if(startupState.canFinish())finishStartupTransition();}
  void finishStartupTransition(){
    FrameLayout layer=startupOverlay;if(layer==null)return;
    startupOverlay=null;startupGeneration++;startupRoomId="";startupState.beginTarget();startupState.beginImage();
    layer.setBackground(null);
    if(layer.getParent() instanceof ViewGroup)((ViewGroup)layer.getParent()).removeView(layer);
    if(startupBitmap!=null){startupBitmap.recycle();startupBitmap=null;}
  }
  void startupNativeReady(){startupNativeReady(startupGeneration,startupState.targetTicket());}
  void startupNativeReady(int generation,int targetTicket){
    if(startupOverlay==null||generation!=startupGeneration||targetTicket!=startupState.targetTicket())return;
    if(screen.equals("home")&&tab==0&&diaryListPage!=null&&!diaryListPage.wallpaperReady()){
      root.postDelayed(()->startupNativeReady(generation,targetTicket),32);return;
    }
    root.getViewTreeObserver().addOnPreDrawListener(new android.view.ViewTreeObserver.OnPreDrawListener(){
      @Override public boolean onPreDraw(){root.getViewTreeObserver().removeOnPreDrawListener(this);
        if(startupOverlay!=null&&generation==startupGeneration&&!screen.equals("editor")&&!screen.equals("telegram")){
          startupState.targetReady(targetTicket);maybeFinishStartup();}return true;}
    });root.invalidate();
  }
  void startupWebReady(WebView target){
    if(startupOverlay==null||target==null)return;
    final int generation=startupGeneration,targetTicket=startupState.targetTicket();
    target.postVisualStateCallback(generation,new WebView.VisualStateCallback(){@Override public void onComplete(long id){
      if(!destroyed&&startupOverlay!=null&&generation==startupGeneration&&web==target){startupState.targetReady(targetTicket);maybeFinishStartup();}
    }});
  }
  void clearWeb(){if(diaryDocumentActions!=null){diaryDocumentActions.dispose();diaryDocumentActions=null;}if(diaryImageViewer!=null){diaryImageViewer.dismiss();diaryImageViewer=null;}editorSceneGeneration++;releaseEditorPreview();if(diaryCapture!=null){diaryCapture.close();diaryCapture=null;}cancelEntryLocation();diaryListPage=null;if(nativePort!=null){nativePort.close();nativePort=null;}if(web!=null){if(telegram!=null&&web==telegram.view){web.evaluateJavascript("window.shiyeQQRebuild?.view?.flushReadingPosition?.()",null);web.onPause();}else{web.stopLoading();web.destroy();}web=null;}}
  boolean drawsBehindStatusBar(){return screen.equals("editor")||(screen.equals("home")&&tab==0)||(screen.equals("telegram")&&!telegramConversationOpen);}
  void updateSystemBars(){
    if(root==null)return;
    boolean dark=screen.equals("home")&&tab==0&&diaryListAppearance!=null?"dark".equals(diaryListAppearance.current().optString("theme")):appTheme!=null&&appTheme.isDark();
    int chrome=dark?0xff17232e:screen.equals("telegram")?(telegramConversationOpen?(qqBlueChrome?0xffeaf5fc:0xffffffff):0xffeaf5fc):BG;
    boolean hasNavigation=navigationBar!=null&&navigationBar.getVisibility()==View.VISIBLE;
    boolean listNavigation=hasNavigation&&((screen.equals("home")&&tab==0)||(screen.equals("telegram")&&!telegramConversationOpen));
    if(screen.equals("home")&&tab==0&&diaryListPage!=null)root.setBackground(diaryListPage.wallpaperBackdrop());
    else if(screen.equals("telegram")&&!telegramConversationOpen&&chatListBackdropBitmap!=null&&!chatListBackdropBitmap.isRecycled()){
      if(chatListBackdropDrawable==null||chatListBackdropDark!=dark){
        chatListBackdropDark=dark;
        chatListBackdropDrawable=new NativeWallpaperDrawable(obj("backgroundMode","custom","theme",dark?"dark":"light","veil","none",
          "background",obj("fill","cover","position","center","opacity",1)),chatListBackdropBitmap);
      }
      if(root.getBackground()!=chatListBackdropDrawable)root.setBackground(chatListBackdropDrawable);
    }
    else root.setBackgroundColor(chrome);
    getWindow().setStatusBarColor(drawsBehindStatusBar()?Color.TRANSPARENT:chrome);
    if(Build.VERSION.SDK_INT>=29)getWindow().setStatusBarContrastEnforced(!drawsBehindStatusBar());
    getWindow().setNavigationBarColor(listNavigation?Color.TRANSPARENT:chrome);
    if(Build.VERSION.SDK_INT>=29)getWindow().setNavigationBarContrastEnforced(!listNavigation);
    if(Build.VERSION.SDK_INT>=30){
      WindowInsetsController controller=getWindow().getInsetsController();
      if(controller!=null)controller.setSystemBarsAppearance(
        dark?0:WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
    }else getWindow().getDecorView().setSystemUiVisibility(
      (dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)|
      (drawsBehindStatusBar()?View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_STABLE:0)|
      (listNavigation?View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE:0));
  }
  void applyDiaryInsets(int top){
    if(screen.equals("editor")&&web!=null){
      float pixels=top/getResources().getDisplayMetrics().density;
      web.evaluateJavascript("document.documentElement.style.setProperty('--diary-native-top-inset','"+pixels+"px')",null);
    }
  }
  void applyDiaryChrome(JSONObject value){diaryChrome=value;if(screen.equals("editor"))updateSystemBars();}
  void applyQQChromeTone(String tone){boolean blue="blue".equals(tone);if(qqBlueChrome!=blue){qqBlueChrome=blue;updateSystemBars();}}
  void applyTelegramChrome(String theme){if(appTheme!=null&&!appTheme.selected())appTheme.adoptLegacy(theme);boolean next=appTheme!=null?appTheme.isDark():"dark".equals(theme);if(telegramDark==next)return;telegramDark=next;if(!screen.equals("telegram"))return;if(navigationBar!=null){navigationTransition.clear();root.removeView(navigationBar);navigationBar=bottomNav();root.addView(navigationBar,lp(-1,56));syncBottomNavigation(false);}else updateSystemBars();}
  void applyGlobalTheme(){
    if(appTheme==null||root==null)return;
    getTheme().applyStyle(appTheme.isDark()?R.style.AppThemeDark:R.style.AppTheme,true);
    telegramDark=appTheme.isDark();
    if(telegram!=null)telegram.applyAppTheme(appTheme.mode());
    if(web!=null&&screen.equals("editor")){JSONObject value=appearance.current();applyDiaryChrome(value);web.evaluateJavascript("window.shiyeApplyAppearance?.("+value.toString()+")",null);}
    appTheme.tintTree(root);
    if(diaryListPage!=null)diaryListPage.applyAppearance(diaryListAppearance.current());
    if(navigationBar!=null){navigationTransition.clear();root.removeView(navigationBar);navigationBar=bottomNav();root.addView(navigationBar,lp(-1,56));syncBottomNavigation(false);}
    if(appSettings!=null)appSettings.themeChanged();
    updateSystemBars();
  }
  void syncBottomNavigation(boolean animate){navigationTransition.apply(navigationBar,navigationRequested&&!imeVisible&&!(screen.equals("telegram")&&telegramConversationOpen),animate);updateSystemBars();}
  /** Reuse the committed local chat preference; no image bytes or file path cross the Web bridge. */
  void refreshChatListBackdrop(JSONObject preference,Consumer<Boolean> settled){loadChatListBackdrop(preference,++chatListBackdropGeneration,settled);}
  void updateChatListWallpaperGeometry(){
    updateChatListWallpaperGeometry(null);
  }
  void updateChatListWallpaperGeometry(Runnable settled){
    if(root==null||telegram==null||!screen.equals("telegram")){if(settled!=null)settled.run();return;}
    root.post(()->{if(!destroyed&&telegram!=null&&screen.equals("telegram"))
      telegram.updateBottomWallpaperGeometry(root.getWidth(),root.getHeight(),settled);
      else if(settled!=null)settled.run();});
  }
  JSONObject chatListWallpaperReceipt(boolean ready){return obj("ready",ready,"displayed",chatListBackdropRecord==null?JSONObject.NULL:chatListBackdropRecord);}
  private void loadChatListBackdrop(JSONObject preference,long ticket,Consumer<Boolean> settled){
    JSONObject requested=preference==null?null:preference.optJSONObject("listBackground");
    boolean hasRequest=preference!=null&&preference.has("listBackground")&&!preference.isNull("listBackground");
    File source=chatBackgrounds.localImage(requested);
    String path=source==null?"":source.getAbsolutePath();
    if(hasRequest&&source==null){if(settled!=null)settled.accept(false);return;}
    if(path.equals(chatListBackdropPath)&&(path.isEmpty()||chatListBackdropBitmap!=null)){
      if(screen.equals("telegram")&&!telegramConversationOpen)updateSystemBars();if(settled!=null)settled.accept(true);return;
    }
    if(source==null){replaceChatListBackdrop("",null,null,ticket);if(settled!=null)settled.accept(true);return;}
    io.execute(()->{Bitmap decoded=chatBackgrounds.decodeLocalImage(source);final Bitmap result=decoded;
      main.post(()->{boolean ready=!destroyed&&ticket==chatListBackdropGeneration&&result!=null;
        if(ready)replaceChatListBackdrop(path,requested,result,ticket);
        else if(result!=null)result.recycle();
        if(settled!=null)settled.accept(ready);
      });
    });
  }
  private void replaceChatListBackdrop(String path,JSONObject record,Bitmap bitmap,long ticket){
    if(ticket!=chatListBackdropGeneration){if(bitmap!=null)bitmap.recycle();return;}
    Bitmap old=chatListBackdropBitmap;chatListBackdropPath=path;chatListBackdropRecord=record;chatListBackdropBitmap=bitmap;chatListBackdropDrawable=null;
    if(screen.equals("telegram")&&!telegramConversationOpen)updateSystemBars();
    if(old!=null&&old!=bitmap)old.recycle();
  }
  void scene(View content,boolean navigation){
    if(startupOverlay!=null)startupState.beginTarget();
    if(!screen.equals("telegram")||telegramConversationOpen)chatListBackdropGeneration++;
    root.requestApplyInsets();navigationTransition.clear();root.removeAllViews();
    root.setPadding(root.getPaddingLeft(),drawsBehindStatusBar()?0:statusInsetPx,root.getPaddingRight(),root.getPaddingBottom());
    root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
    if(screen.equals("home")&&tab==0&&diaryListPage!=null)content.setPadding(0,statusInsetPx,0,0);
    navigationRequested=navigation;navigationBar=null;
    if(navigation){navigationBar=bottomNav();root.addView(navigationBar,lp(-1,56));}
    syncBottomNavigation(false);
    if(screen.equals("telegram"))updateChatListWallpaperGeometry();
    boolean diary=screen.equals("editor")||(screen.equals("home")&&tab==0);
    content.animate().cancel();content.setAlpha(diary||screen.equals("telegram")?1f:.85f);content.setTranslationX(0);
    if(!diary&&!screen.equals("telegram"))content.animate().alpha(1f).setDuration(130).setInterpolator(new android.view.animation.PathInterpolator(.22f,.7f,.2f,1f)).start();
    if(!screen.equals("editor")&&!screen.equals("telegram"))startupNativeReady();
  }
  Bitmap diaryTransitionFrame(){
    if(root==null||root.getWidth()<=0||root.getHeight()<=0||(long)root.getWidth()*root.getHeight()>8_000_000L)return null;
    long started=android.os.SystemClock.uptimeMillis();android.os.Trace.beginSection("shiye.diaryTransitionFrame");
    try{Bitmap bitmap=Bitmap.createBitmap(root.getWidth(),root.getHeight(),Bitmap.Config.ARGB_8888);root.draw(new Canvas(bitmap));return bitmap;}catch(RuntimeException failure){return null;}
    finally{android.os.Trace.endSection();if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("ShiyeRender","diaryTransitionFrame ms="+(android.os.SystemClock.uptimeMillis()-started)+" pixels="+root.getWidth()+"x"+root.getHeight());}
  }
  void releaseEditorPreview(){
    if(editorRevealTimeout!=null){main.removeCallbacks(editorRevealTimeout);editorRevealTimeout=null;}
    if(editorPreview!=null){editorPreview.setImageDrawable(null);if(editorPreview.getParent() instanceof ViewGroup)((ViewGroup)editorPreview.getParent()).removeView(editorPreview);editorPreview=null;}
    if(editorPreviewBitmap!=null){editorPreviewBitmap.recycle();editorPreviewBitmap=null;}
  }
  void sceneEditor(WebView view,Bitmap previous){
    FrameLayout frame=new FrameLayout(this);frame.addView(view,new FrameLayout.LayoutParams(-1,-1));
    if(previous!=null){editorPreviewBitmap=previous;editorPreview=new ImageView(this);editorPreview.setScaleType(ImageView.ScaleType.FIT_XY);editorPreview.setImageBitmap(previous);frame.addView(editorPreview,new FrameLayout.LayoutParams(-1,-1));}
    scene(frame,false);
    final int ticket=editorSceneGeneration;
    editorRevealTimeout=()->{if(!destroyed&&web==view&&ticket==editorSceneGeneration){android.util.Log.w("ShiyeRender","editor preview deadline; revealing current surface");releaseEditorPreview();}};
    main.postDelayed(editorRevealTimeout,5500);
  }
  void revealEditor(WebView target,int ticket,int attempt){
    if(destroyed||web!=target||ticket!=editorSceneGeneration||editorRevealTimeout==null)return;
    target.evaluateJavascript("(()=>{const s=window.shiyeEditor,w=s?.wallpaperState;return [Boolean(s?.ready),w?.generation??0,w?.settled!==false]})()",value->{
      if(destroyed||web!=target||ticket!=editorSceneGeneration||editorRevealTimeout==null)return;
      JSONArray state;try{state=new JSONArray(value);}catch(Exception invalid){state=new JSONArray();}
      if((!state.optBoolean(0)||!state.optBoolean(2))&&attempt<100){target.postDelayed(()->revealEditor(target,ticket,attempt+1),50);return;}
      final long wallpaperGeneration=state.optLong(1,-1);
      target.postVisualStateCallback(ticket,new WebView.VisualStateCallback(){@Override public void onComplete(long id){
        if(destroyed||web!=target||ticket!=editorSceneGeneration||editorRevealTimeout==null)return;
        // The decode may finish while a newer appearance preview is loading. Reveal only
        // the same settled generation; the outer bound still exposes an error/fallback.
        target.evaluateJavascript("Boolean(window.shiyeEditor?.ready&&window.shiyeEditor.wallpaperState?.generation==="+wallpaperGeneration+"&&window.shiyeEditor.wallpaperState?.settled!==false)",verified->{
          if(destroyed||web!=target||ticket!=editorSceneGeneration||editorRevealTimeout==null)return;
          if("true".equals(verified)){releaseEditorPreview();startupWebReady(target);}
          else if(attempt>=100)releaseEditorPreview();
          else target.postDelayed(()->revealEditor(target,ticket,attempt+1),50);
        });
      }});
    });
  }

  View icon(String name,String description,Runnable action){Icon v=new Icon(name,ACCENT);v.setContentDescription(description);v.setBackground(new RippleDrawable(android.content.res.ColorStateList.valueOf(0x183390ec),shape(0x00ffffff,14),null));v.setOnClickListener(x->action.run());v.setMinimumWidth(dp(44));v.setMinimumHeight(dp(44));return v;}
  View pill(String label,boolean selected,Runnable action){TextView t=text(label,13,selected?ACCENT:MUTED);bold(t);t.setGravity(Gravity.CENTER);pad(t,16,9);t.setBackground(shape(selected?PALE:0xfff0eeea,20));t.setOnClickListener(v->action.run());return t;}
  LinearLayout topBar(String title,String subtitle,Runnable back,Runnable more){LinearLayout bar=horizontal();pad(bar,12,7);bar.setMinimumHeight(dp(60));if(back!=null)bar.addView(icon("back","返回",back),lp(44,48));LinearLayout titles=vertical();TextView t=text(title,back==null?23:19,INK);bold(t);titles.addView(t);if(subtitle!=null){TextView sub=text(subtitle,12,MUTED);sub.setPadding(0,dp(3),0,0);titles.addView(sub);}LinearLayout.LayoutParams titleLP=new LinearLayout.LayoutParams(0,-2,1);titleLP.leftMargin=dp(back==null?10:4);bar.addView(titles,titleLP);if(more!=null)bar.addView(icon("more","更多",more),lp(44,48));return bar;}
  View bottomNav(){
    boolean dark=screen.equals("home")&&tab==0&&diaryListAppearance!=null?
      "dark".equals(diaryListAppearance.current().optString("theme")):appTheme!=null&&appTheme.isDark();
    int navAccent=dark?0xff8ed4ff:ACCENT;
    LinearLayout frame=vertical();frame.setBackgroundColor(Color.TRANSPARENT);
    View divider=new View(this);divider.setBackgroundColor(dark?0x80294758:0x80b5d2e3);frame.addView(divider,new LinearLayout.LayoutParams(-1,dp(1)));
    LinearLayout nav=horizontal();nav.setGravity(Gravity.CENTER);nav.setPadding(dp(16),dp(3),dp(16),dp(3));
    int[] destinations={1,-1,0};String[] labels={"随想","写日记","思绪"};String[] icons={"chat","edit","book"};
    for(int i=0;i<3;i++){
      final int destination=destinations[i];final boolean active=destination>=0&&destination==tab;
      LinearLayout item=vertical();item.setGravity(Gravity.CENTER);item.setMinimumHeight(dp(48));
      item.setBackground(new RippleDrawable(android.content.res.ColorStateList.valueOf(0x143390ec),shape(0x00ffffff,16),null));
      Icon glyph=new Icon(icons[i],destination<0||active?navAccent:dark?0xff96afc1:0xff969da5);
      LinearLayout.LayoutParams iconLP=lp(42,24);
      glyph.setBackground(shape(active?(dark?0xff24485d:0xffedf5fe):0x00ffffff,16));item.addView(glyph,iconLP);
      TextView label=text(labels[i],10,active?navAccent:dark?0xffbdcedb:destination<0?0xff525f70:0xff8b929b);
      label.setPadding(0,dp(3),0,0);label.setGravity(Gravity.CENTER);if(active)bold(label);item.addView(label);
      item.setSelected(active);item.setContentDescription(destination<0?"直接新建日记":destination==1?"随想会话列表":"思绪阅读列表");
      item.setOnClickListener(v->{if(active&&(screen.equals("home")||screen.equals("telegram"))){hideKeyboard();if(screen.equals("telegram")&&telegram!=null)telegram.refresh();else if(diaryListPage!=null)diaryListPage.refresh(true);return;}dismissSettingsForModuleChange();leaveTelegram(()->{if(destination<0)startNewDiary("");else{tab=destination;showHome();}});});
      nav.addView(item,new LinearLayout.LayoutParams(0,-1,1));
    }
    frame.addView(nav,new LinearLayout.LayoutParams(-1,0,1));return frame;
  }
  void leaveTelegram(Runnable next){if(screen.equals("telegram")&&telegram!=null)telegram.leave(next);else next.run();}
  void dismissSettingsForModuleChange(){
    if(telegram!=null&&screen.equals("telegram"))telegram.dismissForModuleChange();
    if(appSettings!=null)appSettings.dismissForModuleChange();
    if(appearance!=null)appearance.dismissForModuleChange();
    if(diaryListAppearance!=null)diaryListAppearance.dismissForModuleChange();
    if(startupAppearance!=null)startupAppearance.dismissForModuleChange();
    if(appTheme!=null)appTheme.dismissForModuleChange();
  }
  void telegramViewedRoom(String id){
    if(!screen.equals("telegram"))return;
    String next=id==null?"":id;
    if(startupOverlay!=null&&!startupRoomId.isEmpty()&&next.isEmpty())return;
    if(!telegramRoomId.equals(next)){telegramRoomId=next;remember();}
  }
  void telegramRestoreFailed(){startupRoomId="";telegramViewedRoom("");}
  void telegramConversation(boolean opened){boolean returning=telegramConversationOpen&&!opened;telegramConversationOpen=opened;if(opened)chatListBackdropGeneration++;if(screen.equals("telegram")){root.setPadding(root.getPaddingLeft(),drawsBehindStatusBar()?0:statusInsetPx,root.getPaddingRight(),root.getPaddingBottom());root.requestApplyInsets();syncBottomNavigation(true);if(returning&&telegram!=null)telegram.reloadListWallpaperVisual();}}
  void startNewDiary(String selectedCategory){
    if(openingEntry)return;openingEntry=true;final int returnTab=tab;
    io.execute(()->{try{JSONObject created=store.dispatch(obj("op","createEntryDraft","categoryId",selectedCategory));main.post(()->{openingEntry=false;if(!destroyed){editorReturnTab=returnTab;openEditor(created.optString("id"),false,true);}});}
      catch(Exception error){main.post(()->{openingEntry=false;if(!destroyed)error(error);});}});
  }

  void showHome(){legacyChat=false;hideKeyboard();clearWeb();screen="home";entryId="";roomId="";remember();renderHome();if(diaryListPage!=null)diaryListPage.refresh(false);}
  void renderHome(){if(!screen.equals("home"))return;if(tab==0){if(cachedDiaryListPage!=null&&cachedDiaryListPage.compatibleCatalog()){diaryListPage=cachedDiaryListPage;diaryListPage.attach();}else{diaryListPage=new DiaryListPage(this);cachedDiaryListPage=diaryListPage;}diaryListPage.page.setPadding(0,statusInsetPx,0,0);updateSystemBars();root.requestApplyInsets();return;}if(tab==1&&!legacyChat){openTelegram();return;}LinearLayout page=vertical();page.addView(topBar(tab==0?"思绪":"随想",tab==0?"写下今天，也留住自己":"先前的随想记录",null,this::homeMenu));
    FrameLayout stage=new FrameLayout(this);LinearLayout inner=vertical();pad(inner,22,8);stage.addView(inner,new FrameLayout.LayoutParams(-1,-1));
    if(tab==0){LinearLayout month=horizontal();TextView heading=text(new SimpleDateFormat("yyyy 年 M 月",Locale.CHINA).format(new Date()),16,INK);bold(heading);month.addView(heading,new LinearLayout.LayoutParams(0,-2,1));month.addView(text(catalog.optJSONArray("entries").length()+" 篇思绪",12,MUTED));pad(month,2,10);inner.addView(month,lp(-1,44));}
    EditText finder=new EditText(this);finder.setSingleLine(true);finder.setTextSize(14);finder.setTextColor(INK);finder.setHintTextColor(0xffa29ba6);finder.setHint(tab==0?"搜索标题、正文或标签":"搜索会话");pad(finder,16,10);finder.setBackground(shape(0xffeeece8,15));LinearLayout.LayoutParams fl=lp(-1,46);fl.topMargin=dp(18);inner.addView(finder,fl);finder.setText(search);
    HorizontalScrollView scrollChips=new HorizontalScrollView(this);scrollChips.setHorizontalScrollBarEnabled(false);LinearLayout chips=horizontal();String[] ids=new String[catalog.optJSONArray("categories").length()+1];ids[0]="";JSONArray categories=catalog.optJSONArray("categories");for(int i=0;i<ids.length;i++){final String id=i==0?"":at(categories,i-1).optString("id");String name=i==0?"全部":at(categories,i-1).optString("name");View p=pill(name,category.equals(id),()->{category=id;renderHome();});LinearLayout.LayoutParams pl=lp(-2,38);pl.rightMargin=dp(8);chips.addView(p,pl);}scrollChips.addView(chips);LinearLayout.LayoutParams cl=lp(-1,42);cl.topMargin=dp(16);cl.bottomMargin=dp(8);inner.addView(scrollChips,cl);
    ListView list=new ListView(this);list.setDivider(null);list.setSelector(new android.graphics.drawable.ColorDrawable(0x087965a8));list.setClipToPadding(false);list.setPadding(0,0,0,dp(90));inner.addView(list,new LinearLayout.LayoutParams(-1,0,1));
    final ArrayList<JSONObject> filtered=new ArrayList<>();Runnable filter=()->{filtered.clear();JSONArray source=catalog.optJSONArray(tab==0?"entries":"rooms");String q=finder.getText().toString().trim().toLowerCase(Locale.ROOT);for(int i=0;i<source.length();i++){JSONObject e=at(source,i);if(!category.isEmpty()&&!category.equals(e.optString("categoryId")))continue;String hay=e.optString("title")+e.optString("name")+e.optString("preview")+e.optString("searchText")+e.optJSONArray("tags");if(!q.isEmpty()&&!hay.toLowerCase(Locale.ROOT).contains(q))continue;filtered.add(e);}((BaseAdapter)list.getAdapter()).notifyDataSetChanged();};
    list.setAdapter(new BaseAdapter(){public int getCount(){return filtered.size();}public Object getItem(int p){return filtered.get(p);}public long getItemId(int p){return filtered.get(p).optString("id").hashCode();}public View getView(int p,View old,android.view.ViewGroup parent){return tab==0?diaryCard(filtered.get(p)):roomCard(filtered.get(p),p);}});
    finder.addTextChangedListener(new Watcher(){public void afterTextChanged(Editable s){search=s.toString();filter.run();}});filter.run();
    list.setOnItemClickListener((a,v,p,id)->{JSONObject e=filtered.get(p);if(tab==0)openEditor(e.optString("id"),true);else openRoom(e.optString("id"));});
    list.setOnItemLongClickListener((a,v,p,id)->{JSONObject e=filtered.get(p);if(tab==0)new AlertDialog.Builder(this).setTitle(e.optString("title","未命名思绪")).setItems(new String[]{"打开阅读","删除这篇思绪"},(d,n)->{if(n==0)openEditor(e.optString("id"),true);else new AlertDialog.Builder(this).setTitle("删除这篇思绪？").setMessage("样机中将保留删除标记，不影响其他记录。").setNegativeButton("取消",null).setPositiveButton("删除",(x,y)->call(obj("op","deleteEntry","id",e.optString("id")),r->showHome())).show();}).show();else renameRoom(e);return true;});
    View add=icon("plus",tab==0?"新建思绪":"新建会话",()->{if(tab==0)startNewDiary(category);else createRoom();});add.setBackground(new RippleDrawable(android.content.res.ColorStateList.valueOf(0x307965a8),shape(ACCENT,20),null));((Icon)add).color=0xffffffff;add.setElevation(dp(5));FrameLayout.LayoutParams fab=new FrameLayout.LayoutParams(dp(58),dp(58),Gravity.BOTTOM|Gravity.RIGHT);fab.setMargins(0,0,dp(26),dp(24));stage.addView(add,fab);page.addView(stage,new LinearLayout.LayoutParams(-1,0,1));scene(page,true);
  }
  View diaryCard(JSONObject entry){LinearLayout outer=vertical();pad(outer,0,7);LinearLayout card=horizontal();pad(card,17,18);card.setBackground(shape(0xfffdfcf9,17));String date=day(entry.optString("date"));LinearLayout dateBox=vertical();TextView number=text(date.substring(8),27,ACCENT);number.setTypeface(Typeface.create("serif",Typeface.NORMAL));dateBox.addView(number);dateBox.addView(text(date.substring(5,7)+" 月",10,MUTED));card.addView(dateBox,lp(47,-2));LinearLayout words=vertical();TextView title=text(entry.optString("title").isEmpty()?"未命名思绪":entry.optString("title"),17,INK);bold(title);title.setMaxLines(1);title.setEllipsize(TextUtils.TruncateAt.END);words.addView(title);TextView preview=text(entry.optString("preview"),13,MUTED);preview.setMaxLines(2);preview.setEllipsize(TextUtils.TruncateAt.END);preview.setLineSpacing(dp(3),1);preview.setPadding(0,dp(7),0,dp(10));words.addView(preview);String meta=entry.optString("category","日常")+"  ·  "+entry.optInt("wordCount")+" 字";JSONArray tags=entry.optJSONArray("tags");if(tags!=null&&tags.length()>0)meta+="   #"+tags.optString(0);words.addView(text(meta,10,0xffa39aab));card.addView(words,new LinearLayout.LayoutParams(0,-2,1));outer.addView(card);outer.setContentDescription("思绪："+entry.optString("title"));return outer;}
  View roomCard(JSONObject room,int index){LinearLayout row=horizontal();pad(row,2,18);LinearLayout avatar=vertical();avatar.setGravity(Gravity.CENTER);avatar.setBackground(shape(new int[]{PALE,0xffe8eee6,0xfff2e8df}[index%3],16));Icon glyph=new Icon(index==1?"book":"chat",new int[]{ACCENT,0xff7e9478,0xffb58e69}[index%3]);avatar.addView(glyph,lp(34,34));row.addView(avatar,lp(58,58));LinearLayout words=vertical();LinearLayout head=horizontal();TextView name=text(room.optString("name"),17,INK);bold(name);head.addView(name,new LinearLayout.LayoutParams(0,-2,1));head.addView(text(clock(room.optString("updatedAt")),10,MUTED));words.addView(head);String draft=room.optString("draft");TextView preview=text(draft.isEmpty()?room.optString("preview","还没有消息，写下第一句吧"):"[草稿] "+draft,13,MUTED);preview.setSingleLine(true);preview.setEllipsize(TextUtils.TruncateAt.END);preview.setPadding(0,dp(7),0,dp(4));words.addView(preview);words.addView(text(room.optString("category","日常")+"  ·  "+room.optInt("count")+" 条随想",10,0xffa39aab));LinearLayout.LayoutParams w=new LinearLayout.LayoutParams(0,-2,1);w.leftMargin=dp(14);row.addView(words,w);return row;}
  void homeMenu(){appSettings.show();}
  void startupMenu(){String mode=getPreferences(0).getString("startup","last");int selected=mode.equals("diary")?1:mode.equals("chats")?2:0;
    new AlertDialog.Builder(this).setTitle("启动时打开").setSingleChoiceItems(new String[]{"继续上次页面（默认）","思绪列表","随想列表"},selected,(dialog,index)->{getPreferences(0).edit().putString("startup",new String[]{"last","diary","chats"}[index]).apply();dialog.dismiss();toast("下次打开时生效");}).setNegativeButton("取消",null).show();
  }

  void createRoom(){EditText input=new EditText(this);input.setSingleLine(true);input.setHint("例如：跑步之后");pad(input,22,14);new AlertDialog.Builder(this).setTitle("新建随想会话").setView(input).setNegativeButton("取消",null).setPositiveButton("创建",(d,n)->{String s=input.getText().toString().trim();if(s.isEmpty()){toast("请写一个会话名称");return;}call(obj("op","createRoom","name",s,"categoryId",category),r->{refreshCatalog(()->openRoom(r.optString("id")));});}).show();}
  void renameRoom(JSONObject room){EditText input=new EditText(this);input.setSingleLine(true);input.setText(room.optString("name"));input.setSelection(input.length());pad(input,22,12);new AlertDialog.Builder(this).setTitle("会话名称").setView(input).setNegativeButton("取消",null).setPositiveButton("保存",(d,n)->call(obj("op","renameRoom","id",room.optString("id"),"name",input.getText().toString()),r->refreshCatalog(()->{if(screen.equals("room"))openRoom(room.optString("id"));else renderHome();}))).show();}
  void refreshCatalog(Runnable done){call(obj("op","bootstrap"),c->{catalog=c;done.run();});}
  JSONObject room(String id){JSONArray rooms=catalog.optJSONArray("rooms");if(rooms!=null)for(int i=0;i<rooms.length();i++)if(at(rooms,i).optString("id").equals(id))return at(rooms,i);return obj("id",id,"name","随想","category","日常");}
  void showLegacyChats(){hideKeyboard();clearWeb();legacyChat=true;screen="home";tab=1;entryId="";roomId="";remember();call(obj("op","bootstrap"),value->{catalog=value;renderHome();});}
  void openTelegram(){openTelegram("");}
  void openTelegram(String restoreRoom){hideKeyboard();clearWeb();screen="telegram";entryId="";roomId="";tab=1;telegramRoomId=restoreRoom==null?"":restoreRoom;startupRoomId=startupOverlay==null?"":telegramRoomId;remember();boolean first=telegram==null;if(first){telegramConversationOpen=false;telegram=new TelegramFrontend(this);}web=telegram.view;web.onResume();scene(web,true);if(first)telegram.load();else telegram.resume();if(startupOverlay!=null)telegram.awaitStartupReady(telegramRoomId);}
  void chooseTelegramFiles(ValueCallback<Uri[]> callback,WebChromeClient.FileChooserParams params){
    String[] accepts=params.getAcceptTypes();boolean imagesOnly=accepts.length>0;
    ArrayList<String> types=new ArrayList<>();
    for(String accept:accepts)for(String part:accept.split(",")){String type=part.trim();if(type.isEmpty())continue;if(!type.startsWith("image/")&&!type.startsWith("video/"))imagesOnly=false;if(type.contains("/"))types.add(type);}
    if(types.isEmpty())imagesOnly=false;
    if(imagesOnly){chooseTelegramPhotos(callback);return;}
    completeTelegramPhotos(null);telegramPhotos=callback;
    Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
    pick.setType(types.size()==1?types.get(0):"*/*");
    if(types.size()>1)pick.putExtra(Intent.EXTRA_MIME_TYPES,types.toArray(new String[0]));
    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
    try{startActivityForResult(pick,103);}catch(Exception e){completeTelegramPhotos(null);error(e);}
  }
  void chooseTelegramPhotos(ValueCallback<Uri[]> callback){
    completeTelegramPhotos(null);telegramPhotos=callback;
    attachmentPicker=new AttachmentPicker(this,new AttachmentPicker.Listener(){
      public void onPhoto(Uri uri){completeTelegramPhotos(new Uri[]{uri});}
      public void onPhotos(List<Uri> uris){completeTelegramPhotos(uris.toArray(new Uri[0]));}
      public void onBrowse(){Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("*/*");pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);try{startActivityForResult(pick,103);}catch(Exception e){completeTelegramPhotos(null);error(e);}}
      public void onCancel(){completeTelegramPhotos(null);}
    },true,true);attachmentPicker.show();
  }
  void completeTelegramPhotos(Uri[] uris){ValueCallback<Uri[]> pending=telegramPhotos;telegramPhotos=null;if(pending!=null)pending.onReceiveValue(uris);}
  void openRoom(String id){clearWeb();screen="room";roomId=id;entryId="";replyId="";tab=1;remember();JSONObject selected=room(id);call(obj("op","getMessages","roomId",id,"limit",120),r->{if(!screen.equals("room")||!roomId.equals(id))return;messages=r.optJSONArray("messages");if(messages==null)messages=new JSONArray();buildChat(selected);});}
  void buildChat(JSONObject room){LinearLayout page=vertical();page.addView(topBar(room.optString("name"),room.optString("category","日常")+"  ·  与自己对话",()->{saveAnchor();saveDraftNow();showHome();},()->renameRoom(room)));rule(page);
    messageList=new ListView(this);messageList.setDivider(null);messageList.setSelector(new android.graphics.drawable.ColorDrawable(0x00000000));messageList.setStackFromBottom(true);messageList.setTranscriptMode(AbsListView.TRANSCRIPT_MODE_NORMAL);messageList.setClipToPadding(false);messageList.setPadding(dp(18),dp(12),dp(18),dp(16));chatAdapter=new ChatAdapter();messageList.setAdapter(chatAdapter);page.addView(messageList,new LinearLayout.LayoutParams(-1,0,1));messageList.setOnItemLongClickListener((a,v,p,id)->{messageMenu(at(messages,p));return true;});
    LinearLayout footer=vertical();footer.setBackgroundColor(0xfffdfcf9);rule(footer);replyBar=horizontal();pad(replyBar,18,8);replyBar.setVisibility(View.GONE);footer.addView(replyBar);LinearLayout inputRow=horizontal();pad(inputRow,10,9);inputRow.addView(icon("plus","发送图片",()->pickImage("room:"+roomId,asset->sendCurrent(asset.optString("id",asset.optString("assetId"))))),lp(42,46));composer=new EditText(this);composer.setTextSize(16);composer.setTextColor(INK);composer.setHintTextColor(0xffaaa3af);composer.setHint("此刻，想记下什么？");composer.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE|android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);composer.setMinLines(1);composer.setMaxLines(5);composer.setGravity(Gravity.TOP);pad(composer,13,11);composer.setBackground(shape(0xfff0eeeb,16));inputRow.addView(composer,new LinearLayout.LayoutParams(0,-2,1));sendButton=icon("send","发送随想",()->sendCurrent(""));sendButton.setBackground(shape(ACCENT,15));((Icon)sendButton).color=0xffffffff;LinearLayout.LayoutParams sl=lp(44,44);sl.leftMargin=dp(8);inputRow.addView(sendButton,sl);footer.addView(inputRow);page.addView(footer,lp(-1,-2));scene(page,false);
    restoringDraft=true;composer.setText(room.optString("draft"));composer.setSelection(composer.length());restoringDraft=false;replyId=room.isNull("draftReplyTo")?"":room.optString("draftReplyTo");renderReply();
    composer.addTextChangedListener(new Watcher(){public void afterTextChanged(Editable e){if(restoringDraft)return;if(draftTask!=null)main.removeCallbacks(draftTask);final String target=roomId;draftTask=()->{if(screen.equals("room")&&roomId.equals(target))saveDraftNow();};main.postDelayed(draftTask,350);}});
    messageList.post(()->restoreAnchor(roomId));
  }
  void saveDraftNow(){if(composer==null||!screen.equals("room")||roomId.isEmpty())return;if(draftTask!=null)main.removeCallbacks(draftTask);final String target=roomId,value=composer.getText().toString(),reply=replyId;io.execute(()->{try{store.dispatch(obj("op","saveDraft","roomId",target,"text",value,"replyTo",reply));}catch(Exception e){main.post(()->{if(!destroyed)error(e);});}});}
  void saveAnchor(){if(messageList==null||messages.length()==0)return;int first=messageList.getFirstVisiblePosition();View child=messageList.getChildAt(0);boolean bottom=messageList.getLastVisiblePosition()>=messages.length()-1&&(messageList.getChildCount()==0||messageList.getChildAt(messageList.getChildCount()-1).getBottom()<=messageList.getHeight()+dp(8));anchors.put(roomId,new Anchor(at(messages,first).optString("id"),child==null?0:child.getTop(),bottom));}
  void restoreAnchor(String id){Anchor a=anchors.get(id);if(a==null||a.bottom){messageList.setSelection(Math.max(0,messages.length()-1));return;}for(int i=0;i<messages.length();i++)if(at(messages,i).optString("id").equals(a.id)){messageList.setSelectionFromTop(i,a.offset);return;}messageList.setSelection(Math.max(0,messages.length()-1));}
  void sendCurrent(String assetId){if(sending)return;String value=composer.getText().toString();if(value.trim().isEmpty()&&assetId.isEmpty())return;final String target=roomId;String client=UUID.randomUUID().toString();JSONObject request=obj("op","sendMessage","roomId",target,"clientId",client,"text",value,"replyTo",replyId);if(!assetId.isEmpty())try{request.put("assetId",assetId);}catch(Exception ignored){}sending=true;composer.setEnabled(false);sendButton.setEnabled(false);io.execute(()->{try{JSONObject sent=store.dispatch(request);JSONObject result=store.dispatch(obj("op","getMessages","roomId",target,"limit",120));main.post(()->{if(destroyed)return;sending=false;if(!screen.equals("room")||!roomId.equals(target))return;composer.setEnabled(true);sendButton.setEnabled(true);composer.setText("");replyId="";renderReply();messages=result.optJSONArray("messages");animateMessageId=sent.optString("id");chatAdapter.notifyDataSetChanged();messageList.post(()->messageList.setSelection(Math.max(0,messages.length()-1)));});}catch(Exception e){main.post(()->{sending=false;if(destroyed)return;if(composer!=null){composer.setEnabled(true);sendButton.setEnabled(true);}error(e);});}});}
  void renderReply(){replyBar.removeAllViews();if(replyId.isEmpty()){replyBar.setVisibility(View.GONE);return;}String preview="原消息";for(int i=0;i<messages.length();i++)if(at(messages,i).optString("id").equals(replyId))preview=at(messages,i).optString("text","图片");TextView label=text("回复  ·  "+preview,12,ACCENT);label.setMaxLines(1);label.setEllipsize(TextUtils.TruncateAt.END);replyBar.addView(label,new LinearLayout.LayoutParams(0,-2,1));replyBar.addView(icon("close","取消回复",()->{replyId="";renderReply();saveDraftNow();}),lp(36,30));replyBar.setVisibility(View.VISIBLE);}
  void messageMenu(JSONObject m){if(!m.optString("state","active").equals("active"))return;new AlertDialog.Builder(this).setTitle("这条随想").setItems(new String[]{"回复","复制文字","撤回","撤回并重新编辑"},(d,n)->{if(n==0){replyId=m.optString("id");renderReply();composer.requestFocus();((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(composer,InputMethodManager.SHOW_IMPLICIT);saveDraftNow();}else if(n==1){((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("随想",m.optString("text")));toast("已复制");}else{String oldText=m.optString("text");call(obj("op","withdrawMessage","id",m.optString("id")),r->call(obj("op","getMessages","roomId",roomId,"limit",120),list->{messages=list.optJSONArray("messages");chatAdapter.notifyDataSetChanged();if(n==3){composer.setText(oldText);composer.setSelection(composer.length());composer.requestFocus();}}));}}).show();}
  class ChatAdapter extends BaseAdapter {
    public int getCount(){return messages.length();}public Object getItem(int p){return at(messages,p);}public long getItemId(int p){return at(messages,p).optString("id").hashCode();}public boolean hasStableIds(){return true;}
    public View getView(int p,View old,android.view.ViewGroup parent){JSONObject m=at(messages,p);LinearLayout outer=vertical();if(p==0||!day(m.optString("sentAt")).equals(day(at(messages,p-1).optString("sentAt")))){TextView date=text(displayDate(m.optString("sentAt")),11,0xffaaa3ad);date.setGravity(Gravity.CENTER);pad(date,0,12);outer.addView(date);}
      if(!m.optString("state","active").equals("active")){TextView gone=text("你撤回了一条随想",11,0xffaaa3ad);gone.setGravity(Gravity.CENTER);pad(gone,0,12);outer.addView(gone);return outer;}
      LinearLayout wrapper=horizontal();wrapper.setGravity(Gravity.RIGHT|Gravity.TOP);LinearLayout bubble=vertical();bubble.setBackground(shape(0xffeae3f1,17));pad(bubble,15,12);String ref=m.optString("replyTo");if(!ref.isEmpty()&&!ref.equals("null")){String rt="原消息已撤回";for(int i=0;i<messages.length();i++){JSONObject target=at(messages,i);if(target.optString("id").equals(ref)&&target.optString("state","active").equals("active"))rt=target.optString("text","图片");}TextView reply=text("回复自己  ·  "+rt,11,0xff8a7b99);reply.setMaxLines(2);reply.setEllipsize(TextUtils.TruncateAt.END);reply.setPadding(dp(9),dp(7),dp(9),dp(7));reply.setBackground(shape(0xffdfd6e8,8));LinearLayout.LayoutParams rp=lp(-1,-2);rp.bottomMargin=dp(8);bubble.addView(reply,rp);}
      String asset=findImage(m);if(!asset.isEmpty()){ImageView image=new ImageView(MainActivity.this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setBackground(shape(0xffddd6e5,9));image.setClipToOutline(true);bubble.addView(image,lp(220,155));loadBitmap(asset,image);image.setOnClickListener(v->viewImage(asset));}
      String body=m.optString("text");if(!body.isEmpty()){TextView t=text(body,16,INK);t.setLineSpacing(dp(3),1);t.setTextIsSelectable(false);if(!asset.isEmpty())t.setPadding(0,dp(8),0,0);bubble.addView(t);}
      TextView time=text(clock(m.optString("sentAt")),9,0xff9a8baa);time.setGravity(Gravity.RIGHT);time.setPadding(dp(20),dp(7),0,0);bubble.addView(time);int maxWidth=getResources().getDisplayMetrics().widthPixels-dp(84);bubble.setMinimumWidth(dp(66));LinearLayout.LayoutParams bp=new LinearLayout.LayoutParams(-2,-2);bubble.setLayoutParams(bp);wrapper.addView(bubble,bp);bubble.setOnLongClickListener(v->{messageMenu(m);return true;});bubble.setOnClickListener(v->{if(!asset.isEmpty())viewImage(asset);});outer.addView(wrapper,lp(-1,-2));outer.setPadding(dp(34),dp(5),0,dp(5));bubble.getViewTreeObserver().addOnGlobalLayoutListener(new android.view.ViewTreeObserver.OnGlobalLayoutListener(){public void onGlobalLayout(){if(bubble.getWidth()>maxWidth){bubble.getLayoutParams().width=maxWidth;bubble.requestLayout();}bubble.getViewTreeObserver().removeOnGlobalLayoutListener(this);}});outer.setContentDescription("随想消息 "+m.optString("id"));if(m.optString("id").equals(animateMessageId)){animateMessageId="";bubble.setAlpha(.2f);bubble.setTranslationY(dp(7));bubble.animate().alpha(1f).translationY(0).setDuration(150).setInterpolator(new android.view.animation.DecelerateInterpolator()).start();}return outer;
    }
  }
  String findImage(JSONObject message){if(!message.isNull("assetId")&&!message.optString("assetId").isEmpty())return message.optString("assetId");JSONObject body=message.optJSONObject("body");return body==null?"":findImageNodes(body.optJSONArray("content"));}
  String findImageNodes(JSONArray nodes){if(nodes==null)return "";for(int i=0;i<nodes.length();i++){JSONObject n=at(nodes,i);if(n.optString("type").equals("image"))return n.optJSONObject("attrs").optString("assetId");String child=findImageNodes(n.optJSONArray("content"));if(!child.isEmpty())return child;}return "";}
  File originalFile(String id)throws Exception{try{return store.mediaFile(id);}catch(LocalStore.StoreException failure){if(!"not_found".equals(failure.code))throw failure;return productBridge.media().file(id);}}
  void loadBitmap(String id,ImageView target){io.execute(()->{try{File file=originalFile(id);BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(file.getPath(),options);options.inSampleSize=Math.max(1,Math.max(options.outWidth,options.outHeight)/900);options.inJustDecodeBounds=false;Bitmap b=BitmapFactory.decodeFile(file.getPath(),options);main.post(()->{if(!destroyed&&b!=null)target.setImageBitmap(b);});}catch(Exception ignored){}});}
  void viewImage(String id){if(screen.equals("editor")){try{if(diaryImageViewer!=null)diaryImageViewer.dismiss();diaryImageViewer=DiaryImageViewer.show(this,originalFile(id));}catch(Exception failure){error(failure);}return;}ImageView image=new ImageView(this);image.setBackgroundColor(0xfff2efea);image.setScaleType(ImageView.ScaleType.FIT_CENTER);image.setAdjustViewBounds(true);loadBitmap(id,image);new AlertDialog.Builder(this).setTitle("正文图片").setView(image).setPositiveButton("关闭",null).show();}

  void openEditor(String id){openEditor(id,false);}
  void openEditor(String id,boolean reading){openEditor(id,reading,false);}
  void openEditor(String id,boolean reading,boolean fresh,String searchContext){openEditorPage(id,reading,fresh,searchContext);}
  void openEditor(String id,boolean reading,boolean fresh){openEditorPage(id,reading,fresh,"");}
  void openEditorPage(String id,boolean reading,boolean fresh,String searchContext){Bitmap previous=diaryTransitionFrame();diaryChrome=appearance.current();if(reading)editorReturnTab=0;hideKeyboard();clearWeb();screen="editor";entryId=id;roomId="";tab=0;remember();WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0);web=new WebView(this);web.setBackgroundColor(appTheme.isDark()?0xff1c3042:BG);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setTextZoom(100);web.getSettings().setMinimumFontSize(1);web.getSettings().setMinimumLogicalFontSize(1);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setDomStorageEnabled(true);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){return true;}});web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
      @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri uri=r.getUrl();String path=uri.getPath();if(!"https".equals(uri.getScheme())||!"appassets.androidplatform.net".equals(uri.getHost())||!"GET".equals(r.getMethod())||path==null||path.contains("..")||path.contains("\\"))return missing();try{if(path.startsWith("/appearance/")){File background=appearance.fileForPath(path);return background==null?missing():response(URLConnectionMime(background),new FileInputStream(background));}if(path.startsWith("/media/")){String id=path.substring(7);File f=originalFile(id);String mime=URLConnectionMime(f);return response(mime,new FileInputStream(f));}if(path.startsWith("/public/")||path.equals("/editor.html")||path.equals("/editor.js")||path.equals("/diary-search.js")||path.equals("/diary-actions.js")||path.equals("/editor019.css")||path.equals("/product-content019.js")||path.equals("/editor.css")||path.equals("/android-editor-input.js")||path.equals("/content-algorithms.js")||path.equals("/desktop-entry-adapter.js")||path.equals("/entry-save-preparation.js")||path.equals("/diary-presentation.js")){String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":"text/html";return response(mime,getAssets().open(path.substring(1)));}}catch(Exception ignored){}return missing();}
      @Override public void onPageFinished(WebView v,String url){if(!url.startsWith(ORIGIN+"/editor.html"))return;if(nativePort!=null)nativePort.close();WebMessagePort[] channel=v.createWebMessageChannel();nativePort=channel[0];nativePort.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort port,WebMessage msg){handleWeb(port,msg.getData());}});v.postWebMessage(new WebMessage("shiye-app-port-v1",new WebMessagePort[]{channel[1]}),Uri.parse(ORIGIN));root.requestApplyInsets();revealEditor(v,editorSceneGeneration,0);}
    });diaryCapture=new DiaryScrollCapture(this,web);sceneEditor(web,previous);web.loadUrl(ORIGIN+"/editor.html?id="+Uri.encode(id)+(reading?"&read=1":"")+(fresh?"&new=1":"")+(searchContext==null||searchContext.isEmpty()?"":"&find="+Uri.encode(searchContext)));
  }
  String URLConnectionMime(File f){try(InputStream in=new FileInputStream(f)){String guessed=java.net.URLConnection.guessContentTypeFromStream(new BufferedInputStream(in));return guessed==null?"application/octet-stream":guessed;}catch(Exception e){return "application/octet-stream";}}
  WebResourceResponse response(String mime,InputStream stream){return new WebResourceResponse(mime,(mime.startsWith("text/")||mime.contains("javascript"))?"UTF-8":null,200,"OK",Collections.singletonMap("Cache-Control","no-store"),stream);}
  WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
  void reply(WebMessagePort port,long requestId,JSONObject result,Exception failure){JSONObject answer=obj("requestId",requestId,"ok",failure==null);try{if(failure==null)answer.put("result",result==null?new JSONObject():result);else{answer.put("error",failure.getMessage()==null?"没有完成":failure.getMessage());if(failure instanceof LocalStore.StoreException){LocalStore.StoreException se=(LocalStore.StoreException)failure;answer.put("code",se.code);if(se.current!=null)answer.put("current",se.current);}else if(failure instanceof ProductRepository.RepositoryException)answer.put("code",((ProductRepository.RepositoryException)failure).code);else if(failure instanceof ProductChatStore.ChatException)answer.put("code",((ProductChatStore.ChatException)failure).code);}}catch(Exception ignored){}main.post(()->{if(destroyed)return;try{port.postMessage(new WebMessage(answer.toString()));}catch(IllegalStateException ignored){}});}
  void handleWeb(WebMessagePort port,String raw){if(raw==null||raw.length()>4_000_000)return;try{JSONObject request=new JSONObject(raw);long rid=request.getLong("requestId");String op=request.optString("op");if(op.equals("showEditorKeyboard")){if(!screen.equals("editor")||!entryId.equals(request.optString("entryId"))||web==null){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}web.requestFocus();((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(web,InputMethodManager.SHOW_IMPLICIT);reply(port,rid,obj("requested",true),null);}else if(op.equals("diaryDocumentAction")){diaryDocumentAction(port,rid,request);}else if(op.equals("requestEntryLocation")){requestEntryLocation(port,rid,request);}else if(op.equals("showAppSettings")){appSettings.show(()->call(obj("op","bootstrap"),value->{catalog=value;reply(port,rid,value,null);}));}else if(op.equals("showCategories")){appSettings.showCategories(()->call(obj("op","bootstrap"),value->{catalog=value;reply(port,rid,value,null);}));}else if(op.equals("getAppearance")){reply(port,rid,appearance.current(),null);}else if(op.equals("showAppearance")){appearance.show();reply(port,rid,obj("opened",true),null);}else if(op.equals("pickImages")){if(!screen.equals("editor")||!request.optString("entryId",entryId).equals(entryId)){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}pickImages("entry:"+entryId,assets->io.execute(()->{try{for(int i=0;i<assets.length();i++){JSONObject asset=at(assets,i);productBridge.media().registerLegacy(asset);asset.put("assetId",asset.optString("id"));}reply(port,rid,obj("assets",assets),null);}catch(Exception failure){reply(port,rid,null,failure);}}),failure->reply(port,rid,null,failure));}else if(op.equals("pickImage")){if(!screen.equals("editor")||!request.optString("entryId",entryId).equals(entryId)){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}pickImage("entry:"+entryId,asset->io.execute(()->{try{productBridge.media().registerLegacy(asset);asset.put("assetId",asset.optString("id"));reply(port,rid,asset,null);}catch(Exception failure){reply(port,rid,null,failure);}}),failure->reply(port,rid,null,failure));}else if(op.equals("viewImage")){viewImage(request.optString("assetId"));reply(port,rid,new JSONObject(),null);}else if(op.equals("openPreviousEntry")){openPreviousEntry(port,rid,request);}else if(op.equals("closeEditor")){final String closingId=entryId;io.execute(()->{try{store.dispatch(obj("op","discardEmptyEntryDraft","id",closingId));reply(port,rid,obj("closed",true),null);main.postDelayed(()->{if(!destroyed&&screen.equals("editor")&&entryId.equals(closingId)){tab=editorReturnTab;showHome();}},80);}catch(Exception failure){reply(port,rid,null,failure);}});}else if(op.equals("exportBackup")){exportBackup();reply(port,rid,new JSONObject(),null);}else io.execute(()->{try{JSONObject committed=store.dispatch(request);reply(port,rid,committed,null);if(op.equals("productEntrySave")||op.equals("setEntryPinned")||op.equals("setEntryDeleted"))productBridge.localCommitted();}catch(Exception failure){reply(port,rid,null,failure);}});}catch(Exception e){error(e);}}
  void openPreviousEntry(WebMessagePort port,long rid,JSONObject request){
    final String current=entryId;
    if(!screen.equals("editor")||!current.equals(request.optString("id"))){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}
    io.execute(()->{try{
      store.dispatch(obj("op","discardEmptyEntryDraft","id",current));
      JSONArray entries=store.dispatch(obj("op","bootstrap")).optJSONArray("entries");
      String target="",latest="";if(entries!=null)for(int i=0;i<entries.length();i++){JSONObject item=at(entries,i);String id=item.optString("id"),created=item.optString("createdAt");if(!id.equals(current)&&(target.isEmpty()||created.compareTo(latest)>0)){target=id;latest=created;}}
      final String previousId=target;
      reply(port,rid,obj("found",!target.isEmpty(),"id",target),null);
      if(!previousId.isEmpty())main.postDelayed(()->{if(!destroyed&&screen.equals("editor")&&current.equals(entryId))openEditor(previousId,request.optBoolean("reading"));},80);
    }catch(Exception failure){reply(port,rid,null,failure);}});
  }
  Consumer<Exception> imageFailure;
  AttachmentPicker attachmentPicker;
  void pickImage(String owner,Consumer<JSONObject> result){pickImage(owner,result,e->error(e));}
  void pickImage(String owner,Consumer<JSONObject> result,Consumer<Exception> failure){
    if(imageResult!=null||imagesResult!=null){failure.accept(new IOException("请先完成当前选图"));return;}
    hideKeyboard();pickerOwner=owner;imageResult=result;imageFailure=failure;
    attachmentPicker=new AttachmentPicker(this,new AttachmentPicker.Listener(){
      public void onPhoto(Uri uri){importSelectedPhoto(uri);}
      public void onBrowse(){browseDocuments();}
      public void onCancel(){cancelPendingImage();}
    });attachmentPicker.show();
  }
  void pickImages(String owner,Consumer<JSONArray> result,Consumer<Exception> failure){
    if(imageResult!=null||imagesResult!=null){failure.accept(new IOException("请先完成当前选图"));return;}
    hideKeyboard();pickerOwner=owner;imagesResult=result;imageFailure=failure;imageOriginal=!owner.startsWith("entry:");
    attachmentPicker=new AttachmentPicker(this,new AttachmentPicker.Listener(){
      public void onPhoto(Uri uri){importSelectedPhotos(Collections.singletonList(uri));}
      public void onPhotos(List<Uri> uris){importSelectedPhotos(uris);}
      public void onPhotos(List<Uri> uris,boolean original){imageOriginal=original;importSelectedPhotos(uris);}
      public void onPhoto(Uri uri,boolean original){imageOriginal=original;importSelectedPhotos(Collections.singletonList(uri));}
      public void onBrowse(boolean original){imageOriginal=original;browseDocuments();}
      public void onBrowse(){browseDocuments();}
      public void onCancel(){cancelPendingImage();}
    },false,true,owner.startsWith("entry:"));attachmentPicker.show();
  }
  void browseDocuments(){Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("image/*");pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,imagesResult!=null);try{startActivityForResult(pick,101);}catch(Exception e){cancelPendingImage();}}
  void cancelPendingImage(){Consumer<Exception> fail=imageFailure;imageResult=null;imagesResult=null;imageFailure=null;if(fail!=null)fail.accept(new IOException("已取消选图"));}
  void importSelectedPhotos(List<Uri> uris){
    Consumer<JSONArray> done=imagesResult;Consumer<Exception> failed=imageFailure;String owner=pickerOwner;final boolean original=imageOriginal;
    imagesResult=null;imageFailure=null;if(done==null)return;
    ArrayList<Uri> chosen=new ArrayList<>(uris);
    io.execute(()->{try{
      JSONArray assets=new JSONArray();
      for(Uri uri:chosen)assets.put(DiaryImageImport.load(this,store,uri,original));
      main.post(()->{if(destroyed)return;if(owner.equals("entry:"+entryId)&&screen.equals("editor"))done.accept(assets);else if(failed!=null)failed.accept(new IOException("页面已改变，图片未插入"));});
    }catch(Exception e){main.post(()->{if(!destroyed&&failed!=null)failed.accept(e);});}});
  }
  void importSelectedPhoto(Uri uri){
    Consumer<JSONObject> done=imageResult;Consumer<Exception> failed=imageFailure;String owner=pickerOwner;imageResult=null;imageFailure=null;if(done==null)return;
    String name="图片";try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}catch(Exception ignored){}
    String mime=getContentResolver().getType(uri),display=name;
    io.execute(()->{try(InputStream in=getContentResolver().openInputStream(uri)){
      JSONObject asset=store.importMedia(in,mime==null?"image/jpeg":mime,display);
      main.post(()->{if(destroyed)return;boolean matches=owner.equals("entry:"+entryId)&&screen.equals("editor")||owner.equals("room:"+roomId)&&screen.equals("room");if(matches)done.accept(asset);else if(failed!=null)failed.accept(new IOException("页面已改变，图片未插入"));});
    }catch(Exception e){main.post(()->{if(!destroyed&&failed!=null)failed.accept(e);});}});
  }
  @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){
    super.onRequestPermissionsResult(requestCode,permissions,results);
    if(requestCode==211){
      if(checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)==android.content.pm.PackageManager.PERMISSION_GRANTED||checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)==android.content.pm.PackageManager.PERMISSION_GRANTED)beginEntryLocation();
      else finishEntryLocation(null,"未允许定位，可继续手填地点");
    }else if(attachmentPicker!=null)attachmentPicker.onPermissionsResult(requestCode,permissions,results);
  }
  void diaryDocumentAction(WebMessagePort port,long rid,JSONObject request){
    if(!screen.equals("editor")||web==null||port!=nativePort||!entryId.equals(request.optString("entryId"))){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}
    if(diaryDocumentActions==null)diaryDocumentActions=new DiaryDocumentActions(this,io,id->originalFile(id));
    String action=request.optString("action");
    try{
      switch(action){
        case "copyAll":
          diaryDocumentActions.copy(request.getString("text"));
          reply(port,rid,obj("copied",true),null);break;
        case "shareText":
          diaryDocumentActions.shareText(request.optString("title","思绪"),request.getString("text"));
          reply(port,rid,obj("chooserOpened",true),null);break;
        case "exportTxt":
          diaryDocumentActions.saveTxt(request.optString("name","思绪.txt"),request.getString("text"),(saved,cancelled,failure)->reply(port,rid,obj("saved",saved,"cancelled",cancelled),failure));break;
        case "exportPdf":
          diaryDocumentActions.printDocument(request.optString("title","思绪"),request.getString("html"),(opened,cancelled,failure)->reply(port,rid,obj("printDialogOpened",opened,"cancelled",cancelled),failure));break;
        default: reply(port,rid,null,new IOException("未知的本篇操作"));
      }
    }catch(Exception failure){reply(port,rid,null,failure);}
  }
  void requestEntryLocation(WebMessagePort port,long rid,JSONObject request){
    if(!screen.equals("editor")||!entryId.equals(request.optString("entryId",request.optString("id")))){reply(port,rid,null,new IOException("当前篇目已经改变"));return;}
    if(locationReplyPort!=null){reply(port,rid,null,new IOException("正在获取地点，请稍候"));return;}
    locationReplyPort=port;locationReplyId=rid;locationEntryId=entryId;
    if(checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED&&checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
      try{requestPermissions(new String[]{android.Manifest.permission.ACCESS_COARSE_LOCATION,android.Manifest.permission.ACCESS_FINE_LOCATION},211);}catch(RuntimeException error){finishEntryLocation(null,"定位权限未能打开，可继续手填地点");}
    }else beginEntryLocation();
  }
  void beginEntryLocation(){
    if(locationReplyPort==null)return;
    if(!screen.equals("editor")||!entryId.equals(locationEntryId)){finishEntryLocation(null,"页面已改变，地点未写入");return;}
    if(diaryLocation==null)diaryLocation=new DiaryLocation(this);
    diaryLocation.begin(locationEntryId,new DiaryLocation.Callback(){
      public void onSuccess(String target,JSONObject result){if(screen.equals("editor")&&entryId.equals(target)&&target.equals(locationEntryId))finishEntryLocation(result,null);else finishEntryLocation(null,"页面已改变，地点未写入");}
      public void onError(String target,String code,String message){if(target.equals(locationEntryId))finishEntryLocation(null,message);}
    });
  }
  void finishEntryLocation(JSONObject value,String error){
    WebMessagePort port=locationReplyPort;long rid=locationReplyId;
    locationReplyPort=null;locationEntryId="";
    if(port!=null)reply(port,rid,value,error==null?null:new IOException(error));
  }
  void cancelEntryLocation(){if(diaryLocation!=null)diaryLocation.cancel();if(locationReplyPort!=null)finishEntryLocation(null,"已取消定位，可继续手填地点");}
  @Override protected void onStop(){if(diaryLocation!=null)diaryLocation.cancel();super.onStop();}
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(diaryDocumentActions!=null&&diaryDocumentActions.selected(requestCode,resultCode,data))return;if(requestCode==ChatBackgrounds.PICK_REQUEST){chatBackgrounds.selected(resultCode==RESULT_OK&&data!=null?data.getData():null);}else if(requestCode==ChatFiles.SAVE_REQUEST){chatFiles.selected(resultCode,data);}else if(requestCode==DiaryAppearance.PICK_STARTUP_REQUEST){startupAppearance.picked(resultCode==RESULT_OK&&data!=null?data.getData():null);}else if(requestCode==DiaryAppearance.PICK_LIST_REQUEST){diaryListAppearance.picked(resultCode==RESULT_OK&&data!=null?data.getData():null);}else if(requestCode==DiaryAppearance.PICK_REQUEST){appearance.picked(resultCode==RESULT_OK&&data!=null?data.getData():null);}else if(requestCode==103){if(resultCode==RESULT_OK&&data!=null){ArrayList<Uri> picked=new ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<Math.min(10,data.getClipData().getItemCount());i++)picked.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)picked.add(data.getData());completeTelegramPhotos(picked.isEmpty()?null:picked.toArray(new Uri[0]));}else completeTelegramPhotos(null);}else if(requestCode==101){if(resultCode==RESULT_OK&&data!=null){ArrayList<Uri> picked=new ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<Math.min(50,data.getClipData().getItemCount());i++)picked.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)picked.add(data.getData());if(picked.isEmpty())cancelPendingImage();else if(imagesResult!=null)importSelectedPhotos(picked);else importSelectedPhoto(picked.get(0));}else cancelPendingImage();}else if(requestCode==102&&resultCode==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();work(()->{JSONObject snapshot=store.dispatch(obj("op","exportSnapshot"));try(OutputStream raw=getContentResolver().openOutputStream(uri);ZipOutputStream zip=new ZipOutputStream(raw)){zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(obj("format","shiye-android-prototype-backup","version",1,"library",snapshot).toString().getBytes(StandardCharsets.UTF_8));zip.closeEntry();JSONArray assets=snapshot.optJSONArray("assets");if(assets!=null)for(int i=0;i<assets.length();i++){String id=at(assets,i).optString("id");File f=store.mediaFile(id);zip.putNextEntry(new ZipEntry("media/"+id));try(InputStream in=new FileInputStream(f)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)zip.write(b,0,n);}zip.closeEntry();}}return true;},r->toast("本地备份已导出"));}}
  void exportBackup(){hideKeyboard();Intent create=new Intent(Intent.ACTION_CREATE_DOCUMENT);create.addCategory(Intent.CATEGORY_OPENABLE);create.setType("application/zip");create.putExtra(Intent.EXTRA_TITLE,"拾页样机备份-"+nowDay()+".zip");startActivityForResult(create,102);}
  void hideKeyboard(){View f=getCurrentFocus();if(f!=null)((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(f.getWindowToken(),0);}
  @Override public void onBackPressed(){if(screen.equals("telegram")&&telegram!=null){telegram.back();}else if(screen.equals("editor")&&web!=null){web.evaluateJavascript("window.shiyeEditor?.requestClose?.()",null);}else if(screen.equals("room")){saveAnchor();saveDraftNow();showHome();}else super.onBackPressed();}
  @Override protected void onResume(){super.onResume();if(productBridge!=null)productBridge.foreground(true);updateSystemBars();if(diaryListPage!=null&&screen.equals("home")&&tab==0&&getPreferences(0).getString("diary-refresh-mode","auto").equals("auto"))diaryListPage.refresh(false);}
  @Override protected void onPause(){if(screen.equals("telegram")&&telegram!=null&&web==telegram.view)web.evaluateJavascript("window.shiyeQQRebuild?.view?.flushReadingPosition?.()",null);if(productBridge!=null)productBridge.foreground(false);if(screen.equals("room"))saveDraftNow();if(screen.equals("editor")&&web!=null)web.evaluateJavascript("window.shiyeEditor?.flush?.().catch(()=>{})",null);super.onPause();}
  @Override protected void onSaveInstanceState(Bundle state){state.putInt("tab",tab);state.putString("screen",screen);state.putString("entryId",screen.equals("editor")?entryId:"");state.putString("roomId",screen.equals("room")?roomId:"");state.putString("telegramRoomId",screen.equals("telegram")?telegramRoomId:"");super.onSaveInstanceState(state);}
  @Override protected void onDestroy(){if(diaryLocation!=null)diaryLocation.close();destroyed=true;chatListBackdropGeneration++;if(chatListBackdropBitmap!=null){chatListBackdropBitmap.recycle();chatListBackdropBitmap=null;}finishStartupTransition();closeBackendPages();if(draftTask!=null)main.removeCallbacks(draftTask);clearWeb();navigationTransition.clear();cachedDiaryListPage=null;if(telegram!=null){telegram.dispose();telegram.view.destroy();telegram=null;}chatFiles.dispose();if(stickerServices!=null)stickerServices.close();if(productBridge!=null)productBridge.close();if(attachmentPicker!=null)attachmentPicker.dismiss();io.execute(()->store.close());io.shutdown();super.onDestroy();}
  abstract static class Watcher implements TextWatcher{public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){}}
  class Icon extends View {
    int color;final Drawable glyph;
    Icon(String name,int tint){
      super(MainActivity.this);color=tint;
      String symbol=name.equals("chat")?"chat_bubble":name.equals("book")?"menu_book":name.equals("edit")?"edit_square":name.equals("back")?"arrow_back":name.equals("plus")?"add":name.equals("send")?"arrow_upward":name.equals("close")?"close":name.equals("search")?"search":name.equals("calendar")?"calendar_month":"more_horiz";
      int resource=getResources().getIdentifier("ms_"+symbol,"drawable",getPackageName());
      glyph=getResources().getDrawable(resource,getTheme()).mutate();
    }
    @Override protected void onDraw(Canvas canvas){
      super.onDraw(canvas);int size=dp(24),left=(getWidth()-size)/2,top=(getHeight()-size)/2;
      glyph.setTint(color);glyph.setBounds(left,top,left+size,top+size);glyph.draw(canvas);
    }
  }
}
