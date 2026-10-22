package dev.shiye.app;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.Rect;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.ScrollCaptureCallback;
import android.view.ScrollCaptureSession;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Capture the actual overflow scroller, rather than repeatedly capturing the fixed WebView. */
final class DiaryScrollCapture implements AutoCloseable {
    private final WebView web;
    private final Api31 callback;
    DiaryScrollCapture(Activity activity, WebView view) {
        web = view;
        callback = Build.VERSION.SDK_INT >= 31 ? new Api31(activity, view) : null;
        if (callback != null) web.setScrollCaptureCallback(callback);
    }
    @Override public void close() {
        if (callback != null) { callback.dispose(); web.setScrollCaptureCallback(null); }
    }
    @android.annotation.TargetApi(31)
    static final class Api31 implements ScrollCaptureCallback {
        private final Activity activity;
        private final WebView web;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final Rect bounds = new Rect();
        private double scale = 1, origin;
        private boolean started, disposed;
        private int generation, activeToken;
        Api31(Activity activity, WebView web) { this.activity = activity; this.web = web; }
        private static final String METRICS = "(()=>{const s=document.getElementById('pageScroll');if(!s||!window.shiyeEditor?.ready||document.querySelector('dialog[open]'))return null;const r=s.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:s.clientHeight,scroll:s.scrollTop,total:s.scrollHeight,viewport:innerWidth}})()";
        private void evaluate(String script, Consumer<JSONObject> consumer) {
            AtomicBoolean once = new AtomicBoolean();
            Runnable timeout = () -> { if (once.compareAndSet(false, true)) consumer.accept(null); };
            main.postDelayed(timeout, 1000);
            try { web.evaluateJavascript(script, raw -> {
                if (!once.compareAndSet(false, true)) return;
                main.removeCallbacks(timeout);
                JSONObject value = null;
                try { value = new JSONObject(raw); } catch (Exception ignored) { }
                consumer.accept(value);
            }); } catch (RuntimeException failure) {
                if (once.compareAndSet(false, true)) { main.removeCallbacks(timeout); consumer.accept(null); }
            }
        }
        private boolean alive() { return !disposed && !activity.isDestroyed() && web.isAttachedToWindow(); }
        @Override public void onScrollCaptureSearch(CancellationSignal signal, Consumer<Rect> ready) {
            if (!alive() || signal.isCanceled()) { ready.accept(new Rect()); return; }
            evaluate(METRICS, value -> {
                if (value == null || !alive() || signal.isCanceled() || value.optDouble("total") <= value.optDouble("height")) { ready.accept(new Rect()); return; }
                scale = web.getWidth() / Math.max(1, value.optDouble("viewport"));
                bounds.set((int)Math.round(value.optDouble("left") * scale), (int)Math.round(value.optDouble("top") * scale),
                        (int)Math.round((value.optDouble("left") + value.optDouble("width")) * scale),
                        (int)Math.round((value.optDouble("top") + value.optDouble("height")) * scale));
                if (!bounds.intersect(0, 0, web.getWidth(), web.getHeight())) bounds.setEmpty();
                ready.accept(new Rect(bounds));
            });
        }
        private void restore(int token, Runnable ready) {
            evaluate("(()=>{const s=document.getElementById('pageScroll'),c=window.shiyeDiaryScrollCapture;if(s&&c&&c.token==="+token+"){s.scrollTop=c.top;s.style.scrollBehavior=c.behavior;s.style.overflowAnchor=c.anchor;window.shiyeDiaryScrollCapture=null;}return {restored:true}})()", ignored -> ready.run());
        }
        @Override public void onScrollCaptureStart(ScrollCaptureSession session, CancellationSignal signal, Runnable ready) {
            if (!alive() || signal.isCanceled()) { ready.run(); return; }
            final int ticket = ++generation; activeToken = ticket;
            signal.setOnCancelListener(() -> main.post(() -> {
                if (ticket != generation) return;
                generation++; started=false; restore(ticket, () -> {});
            }));
            evaluate("(()=>{const s=document.getElementById('pageScroll');if(!s)return null;window.shiyeDiaryScrollCapture={token:"+ticket+",top:s.scrollTop,behavior:s.style.scrollBehavior,anchor:s.style.overflowAnchor};s.style.scrollBehavior='auto';s.style.overflowAnchor='none';return {scroll:s.scrollTop}})()", value -> {
                if (ticket == generation && alive() && !signal.isCanceled()) {
                    started = value != null;
                    if (value != null) origin = value.optDouble("scroll");
                }
                ready.run();
            });
        }
        @Override public void onScrollCaptureImageRequest(ScrollCaptureSession session, CancellationSignal signal, Rect requested, Consumer<Rect> complete) {
            final int ticket = generation;
            if (!started || !alive() || signal.isCanceled() || bounds.isEmpty()) { complete.accept(new Rect()); return; }
            final Rect request = new Rect(requested);
            double target = origin + (request.exactCenterY() - bounds.height() / 2.0) / scale;
            evaluate("(()=>{const s=document.getElementById('pageScroll');if(!s)return null;s.scrollTop=" + target + ";return {scroll:s.scrollTop}})()", value -> {
                if (value == null || ticket != generation || !started || signal.isCanceled() || !alive()) { complete.accept(new Rect()); return; }
                int delta = (int)Math.round((value.optDouble("scroll") - origin) * scale);
                Rect available = new Rect(request);
                if (!available.intersect(0, delta, bounds.width(), delta + bounds.height())) { complete.accept(new Rect()); return; }
                Rect local = new Rect(available);
                local.offset(bounds.left, bounds.top - delta);
                web.postVisualStateCallback(ticket, new WebView.VisualStateCallback() {
                    @Override public void onComplete(long ignored) {
                        web.postOnAnimation(() -> web.postOnAnimation(() -> copy(session, signal, ticket, local, available, complete)));
                    }
                });
            });
        }
        private void copy(ScrollCaptureSession session, CancellationSignal signal, int ticket, Rect local, Rect available, Consumer<Rect> complete) {
            if (ticket != generation || !started || signal.isCanceled() || !alive() || local.isEmpty() || (long)local.width() * local.height() > 16_000_000L) { complete.accept(new Rect()); return; }
            final Bitmap bitmap;
            try { bitmap = Bitmap.createBitmap(local.width(), local.height(), Bitmap.Config.ARGB_8888); }
            catch (RuntimeException | OutOfMemoryError failure) { complete.accept(new Rect()); return; }
            int[] location = new int[2]; web.getLocationInWindow(location);
            Rect windowRect = new Rect(local); windowRect.offset(location[0], location[1]);
            try { PixelCopy.request(activity.getWindow(), windowRect, bitmap, result -> {
                try {
                    if (result != PixelCopy.SUCCESS || ticket != generation || !started || signal.isCanceled() || !alive()) { complete.accept(new Rect()); return; }
                    Canvas canvas = session.getSurface().lockHardwareCanvas();
                    try { canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR); canvas.drawBitmap(bitmap, 0, 0, null); }
                    finally { session.getSurface().unlockCanvasAndPost(canvas); }
                    complete.accept(new Rect(available));
                } catch (RuntimeException failure) { complete.accept(new Rect()); }
                finally { bitmap.recycle(); }
            }, main); } catch (RuntimeException failure) { bitmap.recycle(); complete.accept(new Rect()); }
        }
        @Override public void onScrollCaptureEnd(Runnable ready) {
            generation++; started = false;
            restore(activeToken, ready);
        }
        void dispose() { if(disposed)return; disposed = true; generation++; started = false; if(activeToken!=0)restore(activeToken, () -> {}); }
    }
}
