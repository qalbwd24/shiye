package dev.shiye.app;

import android.content.Context;
import android.os.Looper;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;

/** Private product-sync originals only. Repository owns durable body/task references and scheduling. */
public final class ProductOriginals {
    public static final int CHUNK_SIZE = 256 * 1024;
    public static final long MAX_SIZE = 512L * 1024 * 1024;
    private static final int TASK_LIMIT = 64 * 1024;
    private final File directory;
    private final Source source;
    private final AtomicLong generation = new AtomicLong();

    public static final class Spec {
        public final String libraryId, epoch, assetId, sha256, mime;
        public final long size;
        public Spec(String libraryId, String epoch, String assetId, long size, String sha256, String mime) {
            if (!uuid(libraryId) || !uuid(epoch) || assetId == null
                || !assetId.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
                || size < 1 || size > MAX_SIZE || sha256 == null || !sha256.matches("[a-f0-9]{64}")
                || mime == null || mime.length() > 200
                || !mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+"))
                throw new IllegalArgumentException("INVALID_ORIGINAL_SPEC");
            this.libraryId = libraryId; this.epoch = epoch; this.assetId = assetId;
            this.size = size; this.sha256 = sha256; this.mime = mime;
        }
        private String identity() {
            return libraryId + "\n" + epoch + "\n" + assetId + "\n" + size + "\n" + sha256 + "\n" + mime;
        }
    }
    public static final class Status {
        public final String taskId;
        public final long offset, size;
        public final boolean ready;
        /** Null until a complete, size/hash-verified private file exists. Never a partial path. */
        public final File file;
        private Status(String id, long offset, long size, File file) {
            taskId = id; this.offset = offset; this.size = size; this.file = file; ready = file != null;
        }
    }
    public interface Cancellation { boolean isCancelled(); }
    public interface Progress { void committed(Status status); }
    public static final class OriginalException extends IOException {
        public final String code;
        OriginalException(String code) { super(code); this.code = code; }
    }
    static final class Chunk {
        final byte[] bytes; final long offset, total; final String mime;
        Chunk(byte[] bytes, long offset, long total, String mime) {
            this.bytes = bytes; this.offset = offset; this.total = total; this.mime = mime;
        }
    }
    /** Package-private boundary for a deterministic native file runner; no URL/path input. */
    interface Source {
        JSONObject status() throws Exception;
        JSONObject metadata(String assetId) throws Exception;
        Chunk chunk(String assetId, long offset, int length, long expectedSize) throws Exception;
    }
    public ProductOriginals(Context context, AndroidSyncTransport transport) throws IOException {
        this(privateDirectory(context), new Source() {
            public JSONObject status() throws Exception { return transport.getStatus(); }
            public JSONObject metadata(String assetId) throws Exception { return transport.mediaAsset(assetId); }
            public Chunk chunk(String assetId, long offset, int length, long size) throws Exception {
                AndroidSyncTransport.MediaChunk chunk = transport.mediaReadChunk(assetId, offset, length, size);
                return new Chunk(chunk.bytes, chunk.offset, chunk.total, chunk.mime);
            }
        });
    }
    private static File privateDirectory(Context context) throws IOException {
        if (context == null) throw new IllegalArgumentException("CONTEXT_REQUIRED");
        File privateRoot = context.getApplicationContext().getNoBackupFilesDir();
        if (privateRoot == null || !privateRoot.isAbsolute()) throw new IOException("PRIVATE_STORAGE_UNAVAILABLE");
        return new File(privateRoot, "product-originals-v1");
    }
    ProductOriginals(File directory, Source source) throws IOException {
        if (directory == null || source == null) throw new IllegalArgumentException();
        this.directory = directory.getCanonicalFile(); this.source = source;
        if (!this.directory.isDirectory() && !this.directory.mkdirs()) throw new IOException("ORIGINAL_DIRECTORY");
    }
    private static boolean uuid(String value) {
        return value != null && value.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}");
    }
    private static String hex(byte[] value) {
        StringBuilder out = new StringBuilder();
        for (byte b : value) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    public String taskId(Spec spec) throws IOException {
        try { return hex(MessageDigest.getInstance("SHA-256").digest(spec.identity().getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IOException("ORIGINAL_DIGEST", error); }
    }
    private File path(String id, String suffix) throws IOException {
        File file = new File(directory, id + suffix).getCanonicalFile();
        if (!directory.equals(file.getParentFile())) throw new OriginalException("ORIGINAL_PATH");
        return file;
    }
    private static void background() throws OriginalException {
        if (Looper.myLooper() == Looper.getMainLooper()) throw new OriginalException("MAIN_THREAD");
    }
    private void check(long run, Cancellation cancellation) throws OriginalException {
        if (run != generation.get() || Thread.currentThread().isInterrupted()
            || cancellation != null && cancellation.isCancelled()) throw new OriginalException("CANCELLED");
    }
    /** Cancels at chunk/hash boundaries; owner may additionally cancel its transport to interrupt I/O. */
    public void cancel() { generation.incrementAndGet(); }
    private JSONObject readTask(String id, Spec spec) throws Exception {
        AtomicFile file = new AtomicFile(path(id, ".task"));
        JSONObject task;
        try (InputStream input = file.openRead(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n;
            while ((n = input.read(buffer)) != -1) {
                if (bytes.size() + n > TASK_LIMIT) throw new OriginalException("INVALID_CHECKPOINT");
                bytes.write(buffer, 0, n);
            }
            task = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (FileNotFoundException missing) {
            task = new JSONObject().put("version", 1).put("libraryId", spec.libraryId).put("epoch", spec.epoch)
                .put("assetId", spec.assetId).put("size", spec.size).put("sha256", spec.sha256)
                .put("mime", spec.mime).put("offset", 0).put("state", "partial");
        }
        Object offset = task.opt("offset");
        if (task.optInt("version") != 1 || !spec.libraryId.equals(task.optString("libraryId"))
            || !spec.epoch.equals(task.optString("epoch")) || !spec.assetId.equals(task.optString("assetId"))
            || !spec.sha256.equals(task.optString("sha256")) || !spec.mime.equals(task.optString("mime"))
            || task.optLong("size", -1) != spec.size || !(offset instanceof Number)
            || ((Number) offset).doubleValue() != ((Number) offset).longValue()
            || task.optLong("offset", -1) < 0 || task.optLong("offset") > spec.size)
            throw new OriginalException("INVALID_CHECKPOINT");
        return task;
    }
    private void saveTask(String id, JSONObject task) throws Exception {
        AtomicFile file = new AtomicFile(path(id, ".task"));
        byte[] bytes = task.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > TASK_LIMIT) throw new OriginalException("INVALID_CHECKPOINT");
        FileOutputStream output = file.startWrite();
        try {
            output.write(bytes); output.getFD().sync(); file.finishWrite(output);
        } catch (Exception error) { file.failWrite(output); throw error; }
    }
    private String digest(File file, long run, Cancellation cancellation) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[CHUNK_SIZE]; int n;
            while ((n = input.read(buffer)) != -1) { check(run, cancellation); digest.update(buffer, 0, n); }
        }
        check(run, cancellation); return hex(digest.digest());
    }
    private boolean valid(File file, Spec spec, long run, Cancellation cancellation) throws Exception {
        return file.isFile() && file.length() == spec.size && spec.sha256.equals(digest(file, run, cancellation));
    }
    private String identity(Spec spec, String base) throws Exception {
        JSONObject status = source.status();
        if (!spec.libraryId.equals(status.optString("libraryId")) || !spec.epoch.equals(status.optString("epoch")))
            throw new OriginalException("LIBRARY_IDENTITY_CHANGED");
        String current = status.optString("baseUrl");
        if (current.isEmpty() || base != null && !base.equals(current)) throw new OriginalException("CONNECTION_CHANGED");
        return current;
    }
    private void metadata(Spec spec) throws Exception {
        JSONObject value = source.metadata(spec.assetId);
        if (!spec.assetId.equals(value.optString("assetId")) || value.optLong("size", -1) != spec.size
            || !spec.sha256.equals(value.optString("sha256")) || !spec.mime.equalsIgnoreCase(value.optString("mime")))
            throw new OriginalException("ORIGINAL_METADATA_MISMATCH");
        if (!value.optBoolean("available")) throw new OriginalException("ORIGINAL_NOT_AVAILABLE");
    }
    /** No network. Background-only, verifies complete files before returning them. */
    public Status inspect(Spec spec) throws Exception { return operate(spec, false, false, null, null); }
    public File readyFile(Spec spec) throws Exception { return inspect(spec).file; }
    /** Retries the same task; network/hash/cancellation errors retain the part and trusted checkpoint. */
    public Status download(Spec spec, Cancellation cancellation, Progress progress) throws Exception {
        return operate(spec, true, false, cancellation, progress);
    }
    /** Explicit retry after corrupt data: resets checkpoint, retaining part until next download truncates it. */
    public Status restart(Spec spec) throws Exception { return operate(spec, false, true, null, null); }
    private Status operate(Spec spec, boolean download, boolean restart, Cancellation cancellation, Progress progress) throws Exception {
        background(); long run = generation.get(); check(run, cancellation);
        String id = taskId(spec); File part = path(id, ".part"), complete = path(id, ".original");
        try (RandomAccessFile lockFile = new RandomAccessFile(path(id, ".lock"), "rw"); FileChannel channel = lockFile.getChannel()) {
            FileLock lock;
            try { lock = channel.tryLock(); } catch (OverlappingFileLockException busy) { throw new OriginalException("TASK_BUSY"); }
            if (lock == null) throw new OriginalException("TASK_BUSY");
            try {
                JSONObject task = readTask(id, spec);
                if (complete.exists()) {
                    if (!valid(complete, spec, run, cancellation)) throw new OriginalException("ORIGINAL_HASH_MISMATCH");
                    saveTask(id, task.put("offset", spec.size).put("state", "ready"));
                    return new Status(id, spec.size, spec.size, complete);
                }
                if (restart) {
                    saveTask(id, task.put("offset", 0).put("state", "partial"));
                    return new Status(id, 0, spec.size, null);
                }
                long offset = task.getLong("offset");
                if ((!part.exists() && offset > 0) || part.exists() && part.length() < offset)
                    throw new OriginalException("CHECKPOINT_FILE_SHORT");
                // Bytes written before a killed process committed its checkpoint are not trusted.
                if (part.exists() && part.length() > offset) {
                    try (RandomAccessFile output = new RandomAccessFile(part, "rw")) { output.setLength(offset); output.getFD().sync(); }
                }
                if (!download) return new Status(id, offset, spec.size, null);
                String base = identity(spec, null); metadata(spec); identity(spec, base); check(run, cancellation);
                try (RandomAccessFile output = new RandomAccessFile(part, "rw")) {
                    while (offset < spec.size) {
                        check(run, cancellation); identity(spec, base);
                        int length = (int) Math.min(CHUNK_SIZE, spec.size - offset);
                        Chunk chunk = source.chunk(spec.assetId, offset, length, spec.size);
                        check(run, cancellation); identity(spec, base);
                        // Non-renderable logical types (including JSON payloads) are served as safe binary.
                        // Metadata above remains authoritative; this does not accept a different logical MIME.
                        if (chunk == null || chunk.bytes == null || chunk.offset != offset || chunk.total != spec.size
                            || chunk.bytes.length != length || !(spec.mime.equalsIgnoreCase(chunk.mime)
                                || "application/octet-stream".equalsIgnoreCase(chunk.mime)))
                            throw new OriginalException("INVALID_ORIGINAL_RANGE");
                        output.seek(offset); output.write(chunk.bytes); output.getFD().sync();
                        offset += length; saveTask(id, task.put("offset", offset).put("state", "partial"));
                        if (progress != null) progress.committed(new Status(id, offset, spec.size, null));
                    }
                }
                check(run, cancellation); identity(spec, base);
                if (!valid(part, spec, run, cancellation)) {
                    saveTask(id, task.put("state", "hash-mismatch"));
                    throw new OriginalException("ORIGINAL_HASH_MISMATCH");
                }
                check(run, cancellation); identity(spec, base);
                Files.move(part.toPath(), complete.toPath(), StandardCopyOption.ATOMIC_MOVE);
                saveTask(id, task.put("offset", spec.size).put("state", "ready"));
                Status ready = new Status(id, spec.size, spec.size, complete);
                if (progress != null) progress.committed(ready);
                return ready;
            } finally { lock.release(); }
        }
    }
}
