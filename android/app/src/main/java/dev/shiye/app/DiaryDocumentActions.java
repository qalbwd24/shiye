package dev.shiye.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;

/** Optional diary-only native actions. No database, media mutation, or automatic sharing. */
final class DiaryDocumentActions {
    static final int SAVE_REQUEST = 208; // Diary-only SAF slot; 101–103, 204–207, 211 are already owned.
    interface Result { void complete(boolean saved, boolean cancelled, Exception failure); }
    interface MediaResolver { File file(String assetId) throws Exception; }
    private final Activity host;
    private final Executor io;
    private final int saveRequest;
    private final MediaResolver media;
    private final Handler main = new Handler(Looper.getMainLooper());
    private byte[] pendingText;
    private Result pendingResult;
    private WebView printView;
    private Result printResult;
    private int printGeneration;
    private boolean disposed;

    DiaryDocumentActions(Activity host, Executor io, MediaResolver media) {
        this.host = host; this.io = io; this.media = media; this.saveRequest = SAVE_REQUEST;
    }

    // Host invokes these only from an explicit action on the main thread.
    void copy(String fullText) {
        ensureActive();
        ClipboardManager clipboard = (ClipboardManager) host.getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) throw new IllegalStateException("系统剪贴板不可用");
        clipboard.setPrimaryClip(ClipData.newPlainText("思绪全文", fullText));
    }

    void shareText(String title, String fullText) {
        ensureActive();
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, fullText);
        host.startActivity(Intent.createChooser(send, "分享思绪全文"));
    }

    void saveTxt(String fileName, String fullText, Result result) {
        ensureActive();
        if (result == null) throw new IllegalArgumentException("缺少导出结果回调");
        if (pendingResult != null || printView != null) throw new IllegalStateException("请先完成当前本篇操作");
        pendingText = fullText.getBytes(StandardCharsets.UTF_8); pendingResult = result;
        String safe = fileName.replaceAll("[\\\\/\\p{Cntrl}]", "_");
        if (safe.length() > 120) safe = safe.substring(0, 120);
        if (!safe.endsWith(".txt")) safe += ".txt";
        try {
            host.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE).setType("text/plain")
                .putExtra(Intent.EXTRA_TITLE, safe), saveRequest);
        } catch (Exception failure) { finish(false, false, failure); }
    }

    boolean selected(int requestCode, int resultCode, Intent data) {
        if (requestCode != saveRequest) return false;
        if (pendingResult == null || disposed) return true;
        Uri target = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (target == null) { finish(false, true, null); return true; }
        final byte[] bytes = pendingText;
        final Result callback = pendingResult;
        // Release picker state before IO. The callback belongs to this immutable export only.
        pendingText = null; pendingResult = null;
        try {
            io.execute(() -> {
                Exception failure = null;
                try (OutputStream out = host.getContentResolver().openOutputStream(target, "wt")) {
                    if (out == null) throw new IOException("无法写入所选文件");
                    out.write(bytes); out.flush();
                } catch (Exception error) { failure = error; }
                final Exception error = failure;
                host.runOnUiThread(() -> { if (!disposed) callback.complete(error == null, false, error); });
            });
        } catch (Exception failure) { callback.complete(false, false, failure); }
        return true;
    }

    /** Actual Android print adapter. Return means system print UI opened, never PDF saved. */
    PrintJob printReadyDocument(String title, WebView preparedDocument) {
        ensureActive();
        PrintManager manager = (PrintManager) host.getSystemService(Context.PRINT_SERVICE);
        if (manager == null || preparedDocument == null) throw new IllegalStateException("系统打印不可用");
        return manager.print(title, preparedDocument.createPrintDocumentAdapter(title),
            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
    }

    void printDocument(String title, String html, Result result) {
        ensureActive();
        if (result == null || html == null || html.length() > 3_500_000)
            throw new IllegalArgumentException("打印内容过大或缺少回调");
        if (pendingResult != null || printView != null) throw new IllegalStateException("请先完成当前本篇操作");
        final int generation = ++printGeneration;
        printResult = result;
        printView = new WebView(host);
        printView.getSettings().setJavaScriptEnabled(true); // Only same-origin readiness probe; HTML CSP forbids scripts.
        printView.getSettings().setAllowFileAccess(false);
        printView.getSettings().setAllowContentAccess(false);
        printView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        printView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getEncodedPath();
                if (!"GET".equals(request.getMethod()) || !"https".equals(uri.getScheme()) ||
                    !"appassets.androidplatform.net".equals(uri.getHost()) || path == null ||
                    !path.startsWith("/media/") || path.contains("..") || path.contains("\\")) return missing();
                String assetId = Uri.decode(path.substring("/media/".length()));
                if (assetId.isEmpty() || assetId.contains("/") || assetId.contains("\\")) return missing();
                try {
                    File file = media.file(assetId);
                    return new WebResourceResponse(((MainActivity) host).URLConnectionMime(file),
                        null, new FileInputStream(file));
                } catch (Exception failure) { return missing(); }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) finishPrint(false, false, new IOException("打印页面未能载入"));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (generation == printGeneration) pollPrintReady(title, generation, android.os.SystemClock.uptimeMillis() + 15000);
            }
        });
        try {
            printView.loadDataWithBaseURL("https://appassets.androidplatform.net/diary-print/", html, "text/html", "UTF-8", null);
        } catch (Exception failure) { finishPrint(false, false, failure); }
    }

    private void pollPrintReady(String title, int generation, long deadline) {
        if (disposed || generation != printGeneration || printView == null || printResult == null) return;
        printView.evaluateJavascript("(function(){var i=document.images;return document.readyState==='complete'&&(!document.fonts||document.fonts.status==='loaded')&&document.body.getBoundingClientRect().height>0&&Array.prototype.every.call(i,function(x){return x.complete&&x.naturalWidth>0})?'ready':'wait'})()", value -> {
            if (disposed || generation != printGeneration || printView == null || printResult == null) return;
            if ("\"ready\"".equals(value)) {
                try {
                    PrintJob job = printReadyDocument(title, printView);
                    if (job == null) throw new IOException("系统打印未能打开");
                    Result done = printResult; printResult = null;
                    done.complete(true, false, null);
                    // The print adapter continues to own this WebView until its job ends.
                    pollPrintJob(generation, job);
                } catch (Exception failure) { finishPrint(false, false, failure); }
            } else if (android.os.SystemClock.uptimeMillis() >= deadline) {
                finishPrint(false, false, new IOException("图片或排版未就绪，未打开打印"));
            } else main.postDelayed(() -> pollPrintReady(title, generation, deadline), 120);
        });
    }

    private void pollPrintJob(int generation, PrintJob job) {
        if (disposed || generation != printGeneration || printView == null) return;
        if (job.isCompleted() || job.isCancelled() || job.isFailed()) {
            finishPrint(false, false, null);
            return;
        }
        main.postDelayed(() -> pollPrintJob(generation, job), 1000);
    }

    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            java.util.Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    private void finishPrint(boolean opened, boolean cancelled, Exception failure) {
        Result result = printResult; printResult = null; ++printGeneration;
        if (printView != null) { printView.stopLoading(); printView.destroy(); printView = null; }
        if (result != null) result.complete(opened, cancelled, failure);
    }

    void dispose() { disposed = true; finish(false, true, null); finishPrint(false, true, null); }
    private void ensureActive() {
        if (disposed || host.isFinishing() || host.isDestroyed()) throw new IllegalStateException("导出页面已关闭");
    }
    private void finish(boolean saved, boolean cancelled, Exception failure) {
        Result result = pendingResult; pendingResult = null; pendingText = null;
        if (result != null) result.complete(saved, cancelled, failure);
    }
}
