package dev.shiye.app;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.net.Uri;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceResponse;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;
import org.json.JSONObject;

/** Private UI resources only. No diary/media rows or canonical message mutations. */
final class ChatBackgrounds {
    static final int PICK_REQUEST = 206;
    private static final long MAX_BYTES = 20L * 1024 * 1024;
    private final MainActivity host;
    private WebMessagePort pendingPort;
    private String pendingId;
    private int generation;

    ChatBackgrounds(MainActivity activity) { host = activity; }

    void choose(WebMessagePort source, String requestId) {
        if (pendingPort != null) { reply(source, requestId, null, "请先完成当前背景选择"); return; }
        pendingPort = source; pendingId = requestId; generation++;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        try { host.startActivityForResult(intent, PICK_REQUEST); }
        catch (Exception failure) { finish(null, "无法打开图片选择器，请重试"); }
    }

    void selected(Uri uri) {
        if (pendingPort == null) return;
        if (uri == null) { finish(null, null); return; }
        final int token = generation;
        host.io.execute(() -> {
            JSONObject value = null; String error = null;
            try { value = importImage(uri); }
            catch (Exception failure) { error = failure.getMessage(); if (error == null) error = "背景未保存，请重试"; }
            final JSONObject result = value; final String problem = error;
            host.main.post(() -> {
                if (host.destroyed || pendingPort == null || token != generation) { removeUnpublished(result); return; }
                finish(result, problem);
            });
        });
    }

    void cancelOwner(WebMessagePort source) {
        if (source == pendingPort) { pendingPort = null; pendingId = null; generation++; }
    }

    private void removeUnpublished(JSONObject result) {
        String id = result == null ? "" : result.optString("assetId");
        if (!id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) return;
        File directory = new File(host.getFilesDir(), "chat-backgrounds");
        new File(directory, id + ".image").delete();
        new File(directory, id + ".webp").delete();
    }

    private JSONObject importImage(Uri uri) throws Exception {
        File directory = new File(host.getFilesDir(), "chat-backgrounds");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("无法保存背景");
        String id = UUID.randomUUID().toString();
        File image = new File(directory, id + ".image"), avatar = new File(directory, id + ".webp");
        Bitmap decoded = null, oriented = null, thumb = null;
        boolean complete = false;
        try {
            try (InputStream input = host.getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(image)) {
                if (input == null) throw new Exception("无法读取所选图片");
                byte[] bytes = new byte[32768]; long size = 0; int count;
                while ((count = input.read(bytes)) != -1) {
                    size += count; if (size > MAX_BYTES) throw new Exception("背景图片不能超过20MiB");
                    output.write(bytes, 0, count);
                }
                output.getFD().sync();
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(image.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outMimeType == null || !bounds.outMimeType.startsWith("image/"))
                throw new Exception("无法识别所选图片");
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 2048) options.inSampleSize *= 2;
            decoded = BitmapFactory.decodeFile(image.getAbsolutePath(), options);
            if (decoded == null) throw new Exception("无法解码所选图片");
            Matrix matrix = new Matrix();
            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try { orientation = new ExifInterface(image.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL); }
            catch (Exception ignored) { }
            switch (orientation) {
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setScale(1, -1); break;
                case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90); break;
                case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(270); break;
            }
            oriented = matrix.isIdentity() ? decoded : Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
            // Desktop uses a 192px centre-cover WebP thumbnail at quality .85; keep the original wallpaper bytes.
            int side = Math.min(oriented.getWidth(), oriented.getHeight());
            int left = (oriented.getWidth() - side) / 2, top = (oriented.getHeight() - side) / 2;
            thumb = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
            new Canvas(thumb).drawBitmap(oriented, new Rect(left, top, left + side, top + side), new Rect(0, 0, 192, 192), new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG));
            try (FileOutputStream output = new FileOutputStream(avatar)) {
                if (!thumb.compress(Bitmap.CompressFormat.WEBP, 85, output)) throw new Exception("头像缩略图未保存");
                output.getFD().sync();
            }
            String base = MainActivity.ORIGIN + "/telegram/local-background/" + id;
            JSONObject result = MainActivity.obj("assetId", id, "url", base + ".image", "avatarUrl", base + ".webp", "position", "center");
            complete = true; return result;
        } finally {
            if (thumb != null) thumb.recycle();
            if (oriented != null && oriented != decoded) oriented.recycle();
            if (decoded != null) decoded.recycle();
            if (!complete) { image.delete(); avatar.delete(); }
        }
    }

    WebResourceResponse resource(String path) {
        String prefix = "/telegram/local-background/";
        if (!path.startsWith(prefix)) return null;
        String name = path.substring(prefix.length());
        if (!name.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(image|webp)")) return null;
        try {
            File file = new File(new File(host.getFilesDir(), "chat-backgrounds"), name);
            String mime = "image/webp";
            if (name.endsWith(".image")) { BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(file.getAbsolutePath(), bounds); mime = bounds.outMimeType; }
            if (mime == null || !file.isFile()) return null;
            return host.response(mime, new FileInputStream(file));
        } catch (Exception ignored) { return null; }
    }

    /** Resolve only a wallpaper already imported by this owner, never an arbitrary URL or path. */
    File localImage(JSONObject record) {
        if (record == null) return null;
        String id = record.optString("assetId"), url = record.optString("url");
        String prefix = MainActivity.ORIGIN + "/telegram/local-background/";
        if (!url.startsWith(prefix) || !url.endsWith(".image")) return null;
        String urlId = url.substring(prefix.length(), url.length() - ".image".length());
        if (!urlId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}") ||
                (!id.isEmpty() && !id.equals(urlId))) return null;
        File file = new File(new File(host.getFilesDir(), "chat-backgrounds"), urlId + ".image");
        return file.isFile() && file.length() > 0 && file.length() <= MAX_BYTES ? file : null;
    }

    /** Same bounded decode and EXIF orientation as importImage, for the native bottom strip. */
    Bitmap decodeLocalImage(File file) {
        if (file == null) return null;
        Bitmap decoded = null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outMimeType == null || !bounds.outMimeType.startsWith("image/")) return null;
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
            while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 2048) options.inSampleSize *= 2;
            decoded = BitmapFactory.decodeFile(file.getAbsolutePath(), options);
            if (decoded == null) return null;
            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try { orientation = new ExifInterface(file.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL); }
            catch (Exception ignored) { }
            Matrix matrix = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setScale(1, -1); break;
                case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90); break;
                case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(270); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(270); break;
            }
            if (matrix.isIdentity()) return decoded;
            Bitmap ready = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
            if (ready != decoded) decoded.recycle(); return ready;
        } catch (Exception | OutOfMemoryError failure) { if (decoded != null) decoded.recycle(); return null; }
    }

    private void finish(JSONObject value, String error) {
        WebMessagePort source = pendingPort; String id = pendingId; pendingPort = null; pendingId = null;
        if (source != null) reply(source, id, value, error);
    }
    private void reply(WebMessagePort source, String id, JSONObject value, String error) {
        try { source.postMessage(new WebMessage(MainActivity.obj("type", "files-result", "requestId", id, "ok", error == null, "value", value == null ? JSONObject.NULL : value, "error", error == null ? JSONObject.NULL : error).toString())); }
        catch (IllegalStateException ignored) { }
    }
}
