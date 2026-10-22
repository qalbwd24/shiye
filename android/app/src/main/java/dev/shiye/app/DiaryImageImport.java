package dev.shiye.app;

import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.OpenableColumns;
import org.json.JSONObject;
import java.io.*;

/** One bounded, offline import. Existing assets and the selected source URI are never rewritten. */
final class DiaryImageImport {
    private static final long SOURCE_LIMIT = 32L * 1024 * 1024;
    private static final long PIXEL_LIMIT = 40_000_000L;
    // Same balanced profile as public/core/media-compression.js.
    private static final int LONG_EDGE = 2048, JPEG_QUALITY = 60;

    static JSONObject load(Context context, LocalStore store, Uri uri, boolean original) throws Exception {
        String name = "图片", mime = context.getContentResolver().getType(uri);
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
        }
        if (mime == null) mime = "image/jpeg";
        if (original || !(mime.equals("image/jpeg") || mime.equals("image/png") || mime.equals("image/webp"))) {
            try (InputStream input = context.getContentResolver().openInputStream(uri)) {
                return store.importMedia(input, mime, name).put("compressionMode", "original");
            }
        }
        File source = File.createTempFile("diary-image-", ".source", context.getCacheDir());
        File output = null;
        Bitmap bitmap = null;
        try {
            try (InputStream input = context.getContentResolver().openInputStream(uri); OutputStream target = new FileOutputStream(source)) {
                if (input == null) throw new IOException("图片无法读取");
                byte[] buffer = new byte[32768]; long size = 0; int n;
                while ((n = input.read(buffer)) != -1) {
                    if (n == 0) continue;
                    size += n;
                    if (size > SOURCE_LIMIT) throw new IOException("图片源文件超过32MB，请选择较小文件");
                    target.write(buffer, 0, n);
                }
                if (size == 0) throw new IOException("图片文件为空");
            }
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(source.getPath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
                    (long) bounds.outWidth * bounds.outHeight > PIXEL_LIMIT || animated(source, mime))
                return original(store, source, mime, name, "original-preserved");
            BitmapFactory.Options options = new BitmapFactory.Options();
            int edge = Math.max(bounds.outWidth, bounds.outHeight);
            options.inSampleSize = 1;
            while (edge / (options.inSampleSize * 2) >= LONG_EDGE) options.inSampleSize *= 2;
            while ((((long)bounds.outWidth + options.inSampleSize - 1) / options.inSampleSize) *
                    (((long)bounds.outHeight + options.inSampleSize - 1) / options.inSampleSize) > 8_000_000L) options.inSampleSize *= 2;
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            bitmap = BitmapFactory.decodeFile(source.getPath(), options);
            if (bitmap == null) return original(store, source, mime, name, "original-fallback");
            float scale = Math.min(1f, (float)LONG_EDGE / Math.max(bitmap.getWidth(), bitmap.getHeight()));
            int orientation = ExifInterface.ORIENTATION_NORMAL;
            try { orientation = new ExifInterface(source.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL); }
            catch (IOException ignored) { /* A missing EXIF header is not an invented rotation. */ }
            Matrix transform = new Matrix();
            switch (orientation) {
                case 2: transform.setScale(-1, 1); break;
                case 3: transform.setRotate(180); break;
                case 4: transform.setScale(1, -1); break;
                case 5: transform.setRotate(90); transform.postScale(-1, 1); break;
                case 6: transform.setRotate(90); break;
                case 7: transform.setRotate(-90); transform.postScale(-1, 1); break;
                case 8: transform.setRotate(-90); break;
                default: break;
            }
            transform.postScale(scale, scale);
            if (!transform.isIdentity()) {
                Bitmap changed = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), transform, true);
                if (changed != bitmap) { bitmap.recycle(); bitmap = changed; }
            }
            boolean jpeg = mime.equals("image/jpeg");
            String encodedMime = jpeg ? "image/jpeg" : "image/webp";
            output = File.createTempFile("diary-image-", jpeg ? ".jpg" : ".webp", context.getCacheDir());
            try (FileOutputStream target = new FileOutputStream(output)) {
                if (!bitmap.compress(jpeg ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.WEBP, JPEG_QUALITY, target))
                    throw new IOException("图片压缩未完成");
            }
            if (output.length() <= 0 || output.length() >= source.length())
                return original(store, source, mime, name, "original-smaller");
            String encodedName = name.replaceFirst("(?i)\\.[a-z0-9]{1,6}$", "") + (jpeg ? ".jpg" : ".webp");
            try (InputStream input = new FileInputStream(output)) {
                return store.importMedia(input, encodedMime, encodedName)
                        .put("compressionMode", "balanced").put("sourceSize", source.length())
                        .put("width", bitmap.getWidth()).put("height", bitmap.getHeight());
            }
        } catch (OutOfMemoryError failure) {
            throw new IOException("内存暂不足以处理这张图片，请稍后重试或选择较小图片", failure);
        } finally {
            if (bitmap != null) bitmap.recycle();
            if (output != null) output.delete();
            source.delete();
        }
    }

    private static JSONObject original(LocalStore store, File file, String mime, String name, String reason) throws Exception {
        try (InputStream input = new FileInputStream(file)) {
            return store.importMedia(input, mime, name).put("compressionMode", reason);
        }
    }

    private static boolean animated(File file, String mime) throws IOException {
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            if (mime.equals("image/webp")) {
                if (input.length() < 21) return false;
                input.seek(12); byte[] kind = new byte[4]; input.readFully(kind);
                if (new String(kind, "US-ASCII").equals("VP8X")) { input.seek(20); return (input.readUnsignedByte() & 2) != 0; }
            }
            if (mime.equals("image/png")) {
                input.seek(8);
                for (int n = 0; n < 256 && input.getFilePointer() + 12 <= input.length(); n++) {
                    long size = input.readInt() & 0xffffffffL;
                    byte[] kind = new byte[4]; input.readFully(kind);
                    String chunk = new String(kind, "US-ASCII");
                    if (chunk.equals("acTL")) return true;
                    if (chunk.equals("IDAT") || size > input.length() - input.getFilePointer() - 4) return false;
                    input.seek(input.getFilePointer() + size + 4);
                }
            }
            return false;
        }
    }
}
