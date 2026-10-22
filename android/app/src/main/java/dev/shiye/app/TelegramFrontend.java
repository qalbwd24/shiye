package dev.shiye.app;

import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import org.json.JSONObject;
import org.json.JSONArray;

/** Runs the frozen local Telegram Web A mobile UI. Its IDB owns this isolated chat only. */
final class TelegramFrontend {
    private final MainActivity host;
    final WebView view;
    private boolean disposed;
    private WebMessagePort port;
    private int pageGeneration;
    private boolean connecting;
    private boolean messageTextSelection;
    private ActionMode textActionMode;
    private long messageGestureUntil;
    private long messageGestureGeneration=-1;
    private String messageGestureRoom="";
    private Runnable pendingLeave;
    private long flushRequest;
    private int startupTicket;
    private boolean startupPageReady;

    TelegramFrontend(MainActivity activity) {
        host = activity;
        WebView.setWebContentsDebuggingEnabled((host.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        view = new WebView(host) {
            @Override public ActionMode startActionMode(ActionMode.Callback callback, int type) {
                // Keep Chromium's selection handles; only the app's message menu owns actions.
                // Composer and other native text fields retain their normal editing menus.
                ActionMode.Callback2 owner = new ActionMode.Callback2() {
                    @Override public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                        boolean created=callback.onCreateActionMode(mode,menu);
                        if(created)textActionMode=mode;
                        if(messageTextSelection)menu.clear();
                        return created;
                    }
                    @Override public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                        boolean changed=callback.onPrepareActionMode(mode,menu);
                        if(messageTextSelection){menu.clear();return true;}
                        return changed;
                    }
                    @Override public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                        return !messageTextSelection&&callback.onActionItemClicked(mode,item);
                    }
                    @Override public void onDestroyActionMode(ActionMode mode) { if(textActionMode==mode)textActionMode=null;callback.onDestroyActionMode(mode); }
                    @Override public void onGetContentRect(ActionMode mode,View anchor,android.graphics.Rect out) {
                        if(callback instanceof ActionMode.Callback2)((ActionMode.Callback2)callback).onGetContentRect(mode,anchor,out);
                        else super.onGetContentRect(mode,anchor,out);
                    }
                };
                return super.startActionMode(owner,type);
            }
        };
        view.setOnLongClickListener(anchor -> {
            // The app owns message actions. Let explicit selection and editable fields
            // keep Chromium's native handles and clipboard operations.
            WebView.HitTestResult hit=view.getHitTestResult();
            boolean consumed=host.telegramConversationOpen&&!messageTextSelection&&android.os.SystemClock.uptimeMillis()<messageGestureUntil&&hit!=null&&hit.getType()!=WebView.HitTestResult.EDIT_TEXT_TYPE;
            if((host.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0)android.util.Log.d("ShiyeTouch","longClick consumed="+consumed+" hit="+(hit==null?-1:hit.getType())+" selecting="+messageTextSelection);
            return consumed;
        });
        view.setBackgroundColor(host.appTheme.isDark()?0xff1c3042:0xffeef2f5);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        // App typography has its own controls; avoid stacking system font scaling.
        settings.setTextZoom(100);
        settings.setMinimumFontSize(1);
        settings.setMinimumLogicalFontSize(1);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only the user-selected content URIs from onShowFileChooser.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) { return true; }
            @Override public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (disposed) { callback.onReceiveValue(null); return true; }
                if (!host.imeVisible) web.clearFocus();
                host.chooseTelegramFiles(callback,params);
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView web,String url,android.graphics.Bitmap icon){
                startupPageReady=false;
                if(host.startupOverlay!=null&&host.web==view){host.startupState.beginTarget();awaitStartupReady(host.startupRoomId);}
                pageGeneration++;connecting=false;messageTextSelection=false;messageGestureUntil=0;messageGestureGeneration=-1;messageGestureRoom="";
                if(port!=null){host.productBridge.cancelOwner(port);host.chatFiles.cancelOwner(port);host.chatBackgrounds.cancelOwner(port);host.stickerServices.cancelOwner(port);port.close();port=null;}
            }
            @Override public void onPageCommitVisible(WebView web,String url){
                if(!disposed&&url.startsWith(MainActivity.ORIGIN+"/telegram/index.html")){startupPageReady=true;connectPort();}
            }
            @Override public void onPageFinished(WebView web, String url) {
                if (disposed || !url.startsWith(MainActivity.ORIGIN + "/telegram/index.html")) return;
                startupPageReady=true;
                connectPort();
                host.updateChatListWallpaperGeometry();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !(MainActivity.ORIGIN.equals(uri.getScheme() + "://" + uri.getHost())
                    && uri.getPath() != null && (uri.getPath().startsWith("/telegram/") || uri.getPath().equals("/android-chat-start019.html")));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                return asset(request);
            }
        });
        ServiceWorkerController workers = ServiceWorkerController.getInstance();
        workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
        workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
        workers.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return asset(request);
            }
        });
    }

    private String nativeFileScript() {
        try(java.io.InputStream in=host.getAssets().open("native-files.js");java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
            byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");
        }catch(Exception e){return "";}
    }
    void applyAppTheme(String theme) {
        if(disposed)return;
        String value=JSONObject.quote("dark".equals(theme)?"dark":"light");
        view.evaluateJavascript("window.shiyeAppTheme="+value+";window.dispatchEvent(new CustomEvent('shiye-app-theme',{detail:{theme:"+value+"}}));",null);
    }
    void stickerStateChanged(){
        if(!disposed)view.evaluateJavascript("window.dispatchEvent(new Event('shiye-native-stickers-changed'));",null);
    }

    private void connectPort() {
        if(disposed||port!=null||connecting)return;
        connecting=true;final int generation=pageGeneration;
        if (port != null) return;
        String theme=host.appTheme.selected()?"window.shiyeAppTheme="+JSONObject.quote(host.appTheme.mode())+";":"";
        String setup = theme + nativeFileScript() + "\n" + "(()=>{if(window.__shiyeNativeChatInstalled)return;window.__shiyeNativeChatInstalled=true;"
            // Reuse Web A's own media menu callback, so its upload/preview pipeline receives the chosen File.
            + "document.addEventListener('click',event=>{if(event.target.closest?.('.NewChatButton button')){event.preventDefault();event.stopImmediatePropagation();window.dispatchEvent(new Event('shiye-new-topic'));return;}"
            + "if(!event.target.closest?.('button.AttachMenu--button'))return;"
            + "let tries=0;const open=()=>{const item=[...document.querySelectorAll('.MenuItem')].find(e=>e.offsetWidth&&e.offsetHeight&&e.querySelector('.icon-media'));"
            + "if(item)item.click();else if(++tries<8)requestAnimationFrame(open);};requestAnimationFrame(open);},true);"
            + "window.addEventListener('message',e=>{if(e.data!=='shiye-chat-native-port-v1'||!e.ports?.[0])return;"
            + "const p=e.ports[0];window.__shiyeNativeChatPort=p;const requests=new Map();"
            + "const request=(type,value,visual=false)=>new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();"
            + "const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('操作确认超时，请重试'));},type==='file-finish'||type==='background-choose'||type==='app-settings'?600000:type==='sticker-upload-finish'?180000:type.startsWith('sticker-')||type.startsWith('preferences-')?60000:12000);"
            + "requests.set(requestId,{resolve,reject,timer,visual});try{p.postMessage(JSON.stringify({type,requestId,value}));}catch(error){clearTimeout(timer);requests.delete(requestId);reject(error);}});"
            + "const state=detail=>p.postMessage(JSON.stringify({type:'view-state',inConversation:Boolean(detail?.inConversation),roomId:window.shiyeAndroidChat?.snapshot?.().roomId||'',themeReady:Boolean(window.shiyeAndroidChat?.snapshot?.().preferencesReady),qqChromeTone:document.body.dataset.shiyeQqChromeTone||'white',theme:document.body.dataset.shiyeChatTheme==='dark'?'dark':'light'}));"
            + "window.addEventListener('shiye-android-view-state',e=>state(e.detail));"
            + "window.addEventListener('shiye-chat-text-selection',e=>p.postMessage(JSON.stringify({type:'message-selection',active:e.detail?.active===true})));"
            + "window.addEventListener('shiye-chat-message-gesture',e=>p.postMessage(JSON.stringify({type:'message-gesture',active:e.detail?.active===true,roomId:e.detail?.roomId,generation:e.detail?.generation})));"
            + "new MutationObserver(()=>state(window.shiyeAndroidChat?.snapshot?.())).observe(document.body,{attributes:true,attributeFilter:['data-shiye-chat-theme','data-shiye-qq-chrome-tone']});"
            + "p.onmessage=async e=>{let q;try{q=JSON.parse(e.data);if(q.type==='preferences-result'||q.type==='files-result'||q.type==='sticker-result'||q.type==='product-result'){const r=requests.get(q.requestId);if(!r)return;requests.delete(q.requestId);clearTimeout(r.timer);q.ok?r.resolve(q.type==='preferences-result'&&r.visual?{__shiyePreferenceReceipt:true,value:q.value??null,listWallpaper:q.listWallpaper??null}:q.value??null):r.reject(Object.assign(new Error(q.error||'操作未保存，请重试'),{code:q.code||'LOCAL_REQUEST_FAILED'}));return;}if(q.type!=='flush')return;"
            + "if(typeof window.shiyeAndroidChat?.flush!=='function')throw Error('页面尚未准备好');"
            + "await window.shiyeAndroidChat.flush();p.postMessage(JSON.stringify({type:'flushed',requestId:q.requestId,ok:true}));"
            + "}catch(error){p.postMessage(JSON.stringify({type:'flushed',requestId:q?.requestId,ok:false}));}};"
            + "p.start();window.shiyeProductChat?.connect((action,payload)=>request('product-chat',{action,payload}));window.shiyeInstallFiles?.(request);window.shiyeAndroidBackground={choose:()=>request('background-choose')};window.shiyeAndroidPreferences={load:()=>request('preferences-load'),commit:value=>request('preferences-commit',value)};window.__shiyeAndroidVisualPreferences={load:()=>request('preferences-load',undefined,true),commit:value=>request('preferences-commit',value,true)};"
            + "window.shiyeNativeStickerRequest=(type,value)=>{if(!['sticker-state','sticker-request','sticker-upload-begin','sticker-upload-chunk','sticker-upload-finish','sticker-upload-cancel'].includes(type))return Promise.reject(new Error('不支持的收藏操作'));return request(type,value);};window.dispatchEvent(new Event('shiye-native-stickers-ready'));"
            + "window.dispatchEvent(new Event('shiye-native-preferences-ready'));state(window.shiyeAndroidChat?.snapshot?.());});})()";
        view.evaluateJavascript(setup, ignored -> {
            if (disposed||generation!=pageGeneration) return;
            connecting=false;
            if (port != null) { host.productBridge.cancelOwner(port); port.close(); }
            WebMessagePort[] channel = view.createWebMessageChannel();
            port = channel[0];
            port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                @Override public void onMessage(WebMessagePort source, WebMessage message) {
                    if (disposed) return;
                    try {
                        if(message.getData()==null||message.getData().length()>4_000_000)return;
                        JSONObject value = new JSONObject(message.getData());
                        if(value.optString("type").equals("product-chat")) {
                            product(source,value);
                        } else if(value.optString("type").equals("background-choose")) {
                            String requestId=value.optString("requestId");
                            if(!requestId.isEmpty()&&requestId.length()<=80)host.chatBackgrounds.choose(source,requestId);
                        } else if(value.optString("type").startsWith("sticker-")) {
                            host.stickerServices.handle(source,value);
                        } else if(value.optString("type").startsWith("file-")) {
                            host.chatFiles.handle(source,value);
                        } else if(value.optString("type").equals("app-settings")) {
                            host.appSettings.show(()->host.chatFiles.reply(source,value.optString("requestId"),MainActivity.obj("opened",true),null));
                        } else if (value.optString("type").equals("preferences-load") || value.optString("type").equals("preferences-commit")) {
                            preferences(source, value);
                        } else if (value.optString("type").equals("message-selection")) {
                            messageTextSelection=value.optBoolean("active");
                            if(messageTextSelection)messageGestureUntil=0;
                            if(textActionMode!=null)textActionMode.invalidate();
                        } else if (value.optString("type").equals("message-gesture")) {
                            if(source!=port||generation!=pageGeneration)return;
                            String room=value.optString("roomId");long sequence=value.optLong("generation",-1);
                            if(value.optBoolean("active")&&!room.isEmpty()&&room.length()<=160&&sequence>=messageGestureGeneration){messageGestureRoom=room;messageGestureGeneration=sequence;messageGestureUntil=android.os.SystemClock.uptimeMillis()+1500;}
                            else if(room.equals(messageGestureRoom)&&sequence==messageGestureGeneration)messageGestureUntil=0;
                        } else if (value.optString("type").equals("view-state")) {
                            if(!value.optBoolean("inConversation")){messageTextSelection=false;messageGestureUntil=0;}
                            if(value.optBoolean("themeReady"))host.applyTelegramChrome(value.optString("theme"));host.applyQQChromeTone(value.optString("qqChromeTone"));
                            host.telegramConversation(value.optBoolean("inConversation"));
                            host.telegramViewedRoom(value.optString("roomId"));
                        } else if (value.optString("type").equals("flushed") && value.optLong("requestId") == flushRequest) {
                            completeLeave(value.optBoolean("ok"));
                        }
                    } catch (Exception ignored) { }
                }
            });
            view.postWebMessage(new WebMessage("shiye-chat-native-port-v1", new WebMessagePort[]{channel[1]}), Uri.parse(MainActivity.ORIGIN));
        });
    }

    private void product(WebMessagePort source, JSONObject message) throws Exception {
        String id=message.optString("requestId");
        if(id.isEmpty()||id.length()>80)return;
        JSONObject value=message.optJSONObject("value");
        if(value==null)return;
        host.io.execute(()->{
            JSONObject answer=MainActivity.obj("type","product-result","requestId",id);
            try{answer.put("value",host.productBridge.handle(value.optString("action"),value.optJSONObject("payload"),source)).put("ok",true);}
            catch(Exception failure){String code=failure instanceof ProductChatStore.ChatException?((ProductChatStore.ChatException)failure).code:failure instanceof ProductRepository.RepositoryException?((ProductRepository.RepositoryException)failure).code:"PRODUCT_REQUEST_FAILED";try{answer.put("ok",false).put("code",code).put("error","本机数据操作未完成，输入已保留，请重试");}catch(Exception ignored){}}
            host.main.post(()->{if(disposed||source!=port)return;try{source.postMessage(new WebMessage(answer.toString()));}catch(IllegalStateException ignored){}});
        });
    }
    void productChanged(){if(!disposed)view.evaluateJavascript("window.dispatchEvent(new Event('shiye-product-chat-changed'));",null);}

    private void preferences(WebMessagePort source, JSONObject message) throws Exception {
        String requestId = message.getString("requestId");
        if (requestId.isEmpty() || requestId.length() > 80 || message.toString().length() > 131072) return;
        JSONObject request = new JSONObject().put("op", message.optString("type").equals("preferences-load")
            ? "getAndroidChatPreferences" : "saveAndroidChatPreferences");
        if (message.optString("type").equals("preferences-commit")) {
            if (!message.has("value")) throw new IllegalArgumentException("缺少偏好");
            request.put("value", message.get("value"));
        }
        host.io.execute(() -> {
            JSONObject reply = new JSONObject();
            try {
                // dispatch returns only after its finally/endTransaction completes.
                JSONObject committed = host.store.dispatch(request);
                reply.put("type", "preferences-result").put("requestId", requestId)
                    .put("ok", true).put("value", committed.get("value"));
            } catch (Exception failure) {
                try { reply.put("type", "preferences-result").put("requestId", requestId)
                    .put("ok", false).put("error", "置顶偏好未保存，请重试"); } catch (Exception ignored) { }
            }
            host.main.post(() -> {
                if (disposed || source != port) return;
                Runnable respond = () -> {
                    if (disposed || source != port) return;
                    try { source.postMessage(new WebMessage(reply.toString())); } catch (IllegalStateException ignored) { }
                };
                if (!reply.optBoolean("ok")) { respond.run(); return; }
                host.refreshChatListBackdrop(reply.optJSONObject("value"), ready -> {
                    try { reply.put("listWallpaper", host.chatListWallpaperReceipt(ready)); }
                    catch (Exception ignored) { }
                    host.updateChatListWallpaperGeometry(respond);
                });
            });
        });
    }

    private WebResourceResponse asset(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost())
                || !"GET".equals(request.getMethod()) || path == null || !(path.startsWith("/telegram/") || path.equals("/android-chat-start019.html") || path.equals("/native-chat-start019.js"))
                || path.contains("..") || path.contains("\\")) return missing();
        try {
            if(path.startsWith("/telegram/local-background/")){
                WebResourceResponse background=host.chatBackgrounds.resource(path);
                return background==null?missing():background;
            }
            if(path.equals("/telegram/index.html")){
                try(InputStream input=host.getAssets().open(path.substring(1));ByteArrayOutputStream output=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[8192];int count;
                    while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
                    String html=new String(output.toByteArray(),StandardCharsets.UTF_8);
                    String css="<style>:root{--shiye-native-top-inset:"+Float.toString(statusInsetCss(host.statusInsetPx))+"px;--shiye-native-ime-visible:"+(host.imeVisible?"1":"0")+"}</style>";
                    if(!html.contains("<head>"))return missing();
                    html=html.replaceFirst("<head>","<head>"+css);
                    return host.response("text/html",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                }
            }
            return host.response(mime(path), host.getAssets().open(path.substring(1)));
        } catch (Exception ignored) {
            return missing();
        }
    }

    private static String mime(String path) {
        String name = path.toLowerCase(Locale.ROOT);
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".json") || name.endsWith(".webmanifest")) return "application/json";
        if (name.endsWith(".wasm")) return "application/wasm";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        if (name.endsWith(".ttf")) return "font/ttf";
        if (name.endsWith(".mp3")) return "audio/mpeg";
        if (name.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    boolean ownsPort(WebMessagePort candidate) { return !disposed && port == candidate; }
    void load() { view.loadUrl(MainActivity.ORIGIN + "/android-chat-start019.html"); }
    void dismissForModuleChange(){if(!disposed)view.evaluateJavascript("window.shiyeAndroidChat?.dismissForModuleChange?.()",null);}
    void awaitStartupReady(String room){
        if(disposed||host.startupOverlay==null)return;
        int ticket=++startupTicket;
        pollStartup(ticket,room==null?"":room,false);
    }
    private void pollStartup(int ticket,String room,boolean requested){
        if(disposed||ticket!=startupTicket||host.startupOverlay==null||!host.screen.equals("telegram")||host.web!=view)return;
        if(!startupPageReady){view.postDelayed(()->pollStartup(ticket,room,requested),50);return;}
        final int page=pageGeneration;
        view.evaluateJavascript("(()=>{const s=window.shiyeAndroidChat?.snapshot?.(),q=s?.independentChat?.renderer,l=document.querySelector('#LeftColumn');return [Boolean(s?.ready),s?.roomId||'',Boolean(q?.visible&&q?.presentation?.contentVisible),Boolean(l&&l.getBoundingClientRect().width>0&&getComputedStyle(l).visibility!=='hidden'),Boolean(window.__shiyeStartupRoomFailure)]})()",raw->{
            if(disposed||ticket!=startupTicket||page!=pageGeneration||host.startupOverlay==null||!host.screen.equals("telegram")||host.web!=view)return;
            JSONArray state;try{state=new JSONArray(raw);}catch(Exception invalid){state=new JSONArray();}
            String targetRoom=state.optBoolean(4)?"":room;
            if(state.optBoolean(4)&&!room.isEmpty()){host.telegramRestoreFailed();host.toast("上次会话暂未打开，已返回列表");}
            if(state.optBoolean(0)){
                if(!targetRoom.isEmpty()&&!requested){
                    String id=JSONObject.quote(targetRoom);
                    view.evaluateJavascript("window.__shiyeStartupRoomFailure=false;window.shiyeAndroidChat.openRoom("+id+").catch(()=>{window.__shiyeStartupRoomFailure=true})",null);
                    view.postDelayed(()->pollStartup(ticket,targetRoom,true),50);
                    return;
                }
                if((targetRoom.isEmpty()&&state.optString(1).isEmpty()&&state.optBoolean(3))||(!targetRoom.isEmpty()&&targetRoom.equals(state.optString(1))&&state.optBoolean(2))){
                    host.startupWebReady(view);return;
                }
            }
            final String target=targetRoom;final boolean sent=requested;
            view.postDelayed(()->pollStartup(ticket,target,sent),50);
        });
    }
    void retryStartup(){
        if(disposed||host.startupOverlay==null)return;
        // Invalidate the old requested=true poll before reload; a new page must re-open the room.
        ++startupTicket;
        startupPageReady=false;
        view.reload();
        awaitStartupReady(host.startupRoomId);
    }
    private float statusInsetCss(int pixels){
        if(pixels<=0){int id=host.getResources().getIdentifier("status_bar_height","dimen","android");if(id!=0)pixels=host.getResources().getDimensionPixelSize(id);}
        return pixels/host.getResources().getDisplayMetrics().density;
    }
    void updateStatusInset(int pixels){
        if(disposed||!host.screen.equals("telegram")||host.telegramConversationOpen)return;
        view.evaluateJavascript("document.documentElement.style.setProperty('--shiye-native-top-inset','"+Float.toString(statusInsetCss(pixels))+"px')",null);
    }
    void updateImeVisible(boolean visible){
        if(!disposed)view.evaluateJavascript("document.documentElement.style.setProperty('--shiye-native-ime-visible','"+(visible?"1":"0")+"')",null);
    }

    void updateBottomWallpaperGeometry(int widthPixels,int heightPixels){
        updateBottomWallpaperGeometry(widthPixels,heightPixels,null);
    }
    void updateBottomWallpaperGeometry(int widthPixels,int heightPixels,Runnable settled){
        if(disposed||widthPixels<=0||heightPixels<=0){if(settled!=null)settled.run();return;}
        float density=host.getResources().getDisplayMetrics().density;
        String width=Float.toString(widthPixels/density),height=Float.toString(heightPixels/density);
        view.evaluateJavascript("document.documentElement.style.setProperty('--shiye-native-wallpaper-width','"+width+"px');"
            +"document.documentElement.style.setProperty('--shiye-native-wallpaper-height','"+height+"px');"
            +"window.dispatchEvent(new Event('shiye-native-bottom-geometry'));",ignored->{if(settled!=null)settled.run();});
    }

    void resume() {
        if (!disposed) view.evaluateJavascript("window.shiyeAndroidChat?.resume?.().catch(()=>{})", null);
    }
    void reloadListWallpaperVisual() {
        if (!disposed) view.evaluateJavascript("window.shiyeAndroidChat?.reloadListWallpaperVisual?.().catch(()=>{})", null);
    }

    void refresh() {
        if (!disposed) view.evaluateJavascript("window.shiyeAndroidChat?.refresh?.().catch(()=>{})", null);
    }

    void back() {
        view.evaluateJavascript("Boolean(window.shiyeAndroidChat?.back?.())", handled -> {
            if (disposed || !host.screen.equals("telegram")) return;
            if (!"true".equals(handled)) {
                if (view.canGoBack()) view.goBack();
                else host.moveTaskToBack(true);
            }
        });
    }

    void leave(Runnable next) {
        if (disposed || port == null) { next.run(); return; }
        // The list has no active composer. Keep this exact live WebView, its
        // queues and drafts while switching tabs; a metadata refresh is no save barrier.
        if (!host.telegramConversationOpen) { next.run(); return; }
        if (pendingLeave != null) { pendingLeave = next; return; }
        pendingLeave = next;
        final long request = ++flushRequest;
        try { port.postMessage(new WebMessage("{\"type\":\"flush\",\"requestId\":" + request + "}")); }
        catch (IllegalStateException failure) { completeLeave(false); return; }
        host.main.postDelayed(() -> {
            if (!disposed && request == flushRequest && pendingLeave != null) {
                completeLeave(false);
            }
        }, 8000);
    }

    private void completeLeave(boolean confirmed) {
        Runnable next = pendingLeave; pendingLeave = null;
        if (next == null || disposed) return;
        if (!confirmed) host.toast("保存尚未确认，输入保留在随想页面，可返回继续或重试");
        // MainActivity retains this WebView and never clears its input here.
        // This is recoverable navigation, not a fabricated persistence ACK.
        next.run();
    }

    void dispose() { disposed = true; pendingLeave = null; if (port != null) { host.chatFiles.cancelOwner(port); host.chatBackgrounds.cancelOwner(port); host.stickerServices.cancelOwner(port); host.productBridge.cancelOwner(port); port.close(); port = null; } host.completeTelegramPhotos(null); }
}
