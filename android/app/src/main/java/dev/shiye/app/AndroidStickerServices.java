package dev.shiye.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import javax.net.ssl.SSLException;
import static dev.shiye.app.BackendServices.Failure;
import static dev.shiye.app.BackendServices.ServiceException;

/** Explicit, fixed sticker transport. No network on construction or diary I/O queue.
 * Host calls synchronous methods through executor(), and owns WebMessagePort callbacks. */
public final class AndroidStickerServices implements AutoCloseable {
    public static final int CHUNK_BYTES = 131072;
    public static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final int JSON_LIMIT = 2 * 1024 * 1024;
    private static final Object SCOPE_LOCK = new Object();
    private final BackendServices backend;
    private final SharedPreferences scopePrefs;
    private final File staging;
    private final AtomicLong lifecycle = new AtomicLong();
    private final Object connectionLock = new Object();
    private final ExecutorService network = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "shiye-sticker-network"); thread.setDaemon(true); return thread;
    });
    private volatile Session connected;
    private volatile HttpURLConnection inFlight;
    private final Map<String, Upload> uploads = new HashMap<>();

    private static final class Session {
        final BackendServices.Snapshot config; final long epoch;
        final Map<String, JSONObject> media = new HashMap<>();
        final Map<String, ReadProgress> reads = new LinkedHashMap<>();
        Session(BackendServices.Snapshot config, long epoch) { this.config = config; this.epoch = epoch; }
    }
    private static final class Upload {
        final Object owner; final String token, name, expectedHash; final long size;
        final File file; final Session session; final Long lastModified; long received;
        Upload(Object owner, String name, long size, String hash, File file, Session session, Long lastModified) {
            this.owner = owner; this.name = name; this.size = size; this.expectedHash = hash;
            this.file = file; this.session = session; this.lastModified = lastModified; token = UUID.randomUUID().toString();
        }
    }
    private static final class ReadProgress {
        final MessageDigest digest = digest(); final String signature;
        final long size; long next, lastOffset = -1; JSONObject lastResult;
        ReadProgress(JSONObject media) { signature = media.toString(); size = media.optLong("size"); }
    }

    public AndroidStickerServices(Context context, BackendServices backend) {
        this.backend = backend;
        Context app = context.getApplicationContext();
        scopePrefs = app.getSharedPreferences("sticker_service_scope_v1", Context.MODE_PRIVATE);
        staging = new File(app.getCacheDir(), "sticker-original-staging");
    }
    public ExecutorService executor() { return network; }
    public String getPinnedBaseUrl() {
        synchronized (SCOPE_LOCK) { return scopePrefs.getString("baseUrl", ""); }
    }
    public boolean isConnected() {
        Session current = connected;
        return current != null && current.epoch == lifecycle.get() && current.config.baseUrl.equals(backend.getBaseUrl());
    }

    /** Explicit user action only. Does not read/upload local favorites or enable shared sync. */
    public synchronized JSONObject connect() throws ServiceException {
        BackendServices.Snapshot config = backend.snapshot();
        checkScope(config);
        long epoch;
        synchronized (connectionLock) { epoch = lifecycle.incrementAndGet(); connected = null; }
        clearUploads();
        Session candidate = new Session(config, epoch);
        JSONObject health = json(candidate, false, "GET", "/api/health", null, null, null, null);
        JSONObject capability = health.optJSONObject("stickerCollection");
        if (capability == null || !numberEquals(capability.opt("version"), 1)
            || !numberEquals(capability.opt("metadata"), 1) || !Boolean.TRUE.equals(capability.opt("catalog"))
            || !Boolean.TRUE.equals(capability.opt("fromMessage")))
            throw fail(Failure.UNSUPPORTED, "服务尚未提供兼容的收藏与备注接口");
        check(candidate, false);
        synchronized (SCOPE_LOCK) {
            checkScope(config);
            if (scopePrefs.getString("baseUrl", "").isEmpty()
                && !scopePrefs.edit().putString("baseUrl", config.baseUrl).commit())
                throw fail(Failure.STORAGE, "收藏服务作用域保存失败，未启用连接");
        }
        synchronized (connectionLock) { check(candidate, false); connected = candidate; }
        return object("baseUrl", config.baseUrl, "scopeBaseUrl", getPinnedBaseUrl(), "health", health);
    }

    /** Immediate generation invalidation; original local favorites/mappings are never removed. */
    public void disconnect() {
        synchronized (connectionLock) { lifecycle.incrementAndGet(); connected = null; }
        HttpURLConnection connection = inFlight; if (connection != null) connection.disconnect();
        try { if (!network.isShutdown()) network.execute(() -> { synchronized (this) { clearUploads(); } }); }
        catch (java.util.concurrent.RejectedExecutionException ignored) { /* Already closing. */ }
    }
    @Override public void close() { disconnect(); network.shutdown(); }

    /** action is catalog/collect/from-message/update/media only; no caller URL or HTTP method. */
    public synchronized JSONObject request(String action, JSONObject payload) throws ServiceException {
        Session session = session();
        JSONObject input = copy(payload == null ? new JSONObject() : payload);
        try {
            if ("catalog".equals(action)) {
                fields(input, "includeDeleted");
                if (input.has("includeDeleted") && !(input.opt("includeDeleted") instanceof Boolean))
                    throw fail(Failure.INVALID_INPUT, "收藏目录参数不正确");
                JSONObject result = json(session, true, "GET", "/api/stickers/catalog"
                    + (input.optBoolean("includeDeleted", false) ? "?includeDeleted=1" : ""), null, null, null, null);
                if (!numberEquals(result.opt("version"), 1) || !(result.opt("items") instanceof JSONArray))
                    throw fail(Failure.INVALID_RESPONSE, "收藏目录格式不兼容，已有本地素材已保留");
                Map<String, JSONObject> media = new HashMap<>();
                JSONArray items = result.getJSONArray("items");
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i), asset = item == null ? null : item.optJSONObject("media");
                    if (asset != null && safeId(asset.optString("id"))) media.put(asset.getString("id"), copy(asset));
                }
                check(session, true); session.media.putAll(media); // Empty catalog never deletes a local original/mapping.
                return result;
            }
            if ("media".equals(action)) {
                fields(input, "mediaId", "offset");
                return media(session, id(input, "mediaId"), integer(input, "offset", 0, MAX_BYTES));
            }
            if ("collect".equals(action)) {
                fields(input, "mediaId", "name", "group", "note"); id(input, "mediaId"); metadata(input);
                JSONObject result = json(session, true, "POST", "/api/stickers", input, null, null, null);
                if (!safeId(result.optString("id")) || !input.getString("mediaId").equals(result.optString("mediaId")))
                    throw fail(Failure.INVALID_RESPONSE, "收藏资源回执不匹配，本地素材已保留");
                return result;
            }
            if ("from-message".equals(action)) {
                fields(input, "version", "source", "mediaId", "occurrenceId", "name", "group", "note");
                if (!numberEquals(input.opt("version"), 1)) throw fail(Failure.INVALID_INPUT, "收藏来源版本不正确");
                validateSource(input.optJSONObject("source"));
                if (input.has("mediaId")) id(input, "mediaId");
                if (input.has("occurrenceId")) text(input, "occurrenceId", 500, false);
                metadata(input);
                JSONObject result = json(session, true, "POST", "/api/stickers/from-message", input, null, null, null);
                JSONObject asset = result.optJSONObject("media");
                JSONObject sticker = result.optJSONObject("sticker");
                if (!numberEquals(result.opt("version"), 1) || !sameSource(input.getJSONObject("source"), result.optJSONObject("source"))
                    || sticker == null || !safeId(sticker.optString("id")) || asset == null
                    || !sticker.optString("mediaId").equals(asset.optString("id"))
                    || (input.has("mediaId") && !input.getString("mediaId").equals(asset.optString("id"))))
                    throw fail(Failure.INVALID_RESPONSE, "消息收藏来源或资源回执不匹配");
                check(session, true);
                if (asset != null && safeId(asset.optString("id"))) session.media.put(asset.getString("id"), copy(asset));
                return result;
            }
            if ("update".equals(action)) {
                fields(input, "id", "name", "group", "deleted", "note");
                String stickerId = id(input, "id");
                if (!stickerId.matches("[a-f0-9-]{1,100}") || input.length() < 2
                    || (input.has("deleted") && !(input.opt("deleted") instanceof Boolean)))
                    throw fail(Failure.INVALID_INPUT, "收藏编辑参数不正确");
                metadata(input); input.remove("id");
                JSONObject result = json(session, true, "PUT", "/api/stickers/" + stickerId, input, null, null, null);
                if (!stickerId.equals(result.optString("id"))) throw fail(Failure.INVALID_RESPONSE, "收藏编辑回执不匹配");
                return result;
            }
            throw fail(Failure.INVALID_INPUT, "不支持的收藏操作");
        } catch (JSONException ignored) { throw fail(Failure.INVALID_RESPONSE, "收藏响应格式不正确"); }
    }

    /** owner must be the native port/session object, never a renderer-supplied identity. */
    public synchronized JSONObject uploadBegin(Object owner, JSONObject metadata) throws ServiceException {
        Session session = session(); fields(metadata, "name", "mime", "size", "sha256", "lastModified");
        if (owner == null || uploads.size() >= 2) throw fail(Failure.INVALID_INPUT, "请先完成当前原件传输");
        String name = text(metadata, "name", 250, false), hash = text(metadata, "sha256", 64, false);
        if (!hash.matches("[a-f0-9]{64}")) throw fail(Failure.INVALID_INPUT, "原件校验值不正确");
        long size = integer(metadata, "size", 1, 9007199254740991L);
        if (size > MAX_BYTES) throw fail(Failure.TOO_LARGE, "新收藏原件不能超过64 MiB，本地素材已保留");
        if (metadata.has("mime")) text(metadata, "mime", 80, true); // Advisory only; actual bytes decide upload MIME.
        Long lastModified = metadata.has("lastModified") ? integer(metadata, "lastModified", 0, 8640000000000000L) : null;
        File temporary = null;
        try {
            if (!staging.isDirectory() && !staging.mkdirs()) throw new IOException();
            temporary = File.createTempFile("original-", ".part", staging);
            Upload upload = new Upload(owner, name, size, hash, temporary, session, lastModified);
            check(session, true); uploads.put(upload.token, upload);
            return object("token", upload.token, "chunkBytes", CHUNK_BYTES, "received", 0);
        } catch (IOException ignored) { if (temporary != null) temporary.delete(); throw fail(Failure.STORAGE, "无法准备原件临时文件，本地素材已保留");
        } catch (ServiceException error) { if (temporary != null) temporary.delete(); throw error; }
    }

    public synchronized JSONObject uploadAppend(Object owner, String token, long offset, String base64) throws ServiceException {
        Upload upload = upload(owner, token); check(upload.session, true);
        if (offset != upload.received || base64 == null || base64.length() > ((CHUNK_BYTES + 2) / 3) * 4
            || !base64.matches("[A-Za-z0-9+/]*={0,2}"))
            throw fail(Failure.INVALID_INPUT, "原件分块顺序或大小不正确");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(base64); }
        catch (IllegalArgumentException ignored) { throw fail(Failure.INVALID_INPUT, "原件分块编码不正确"); }
        if (bytes.length == 0 || bytes.length > CHUNK_BYTES || upload.received + bytes.length > upload.size)
            throw fail(Failure.TOO_LARGE, "原件分块或总长度超出限制");
        try (OutputStream out = new FileOutputStream(upload.file, true)) { out.write(bytes); }
        catch (IOException ignored) { throw fail(Failure.STORAGE, "原件临时保存失败，本地素材已保留"); }
        upload.received += bytes.length; check(upload.session, true);
        return object("token", token, "received", upload.received);
    }

    public synchronized JSONObject uploadFinish(Object owner, String token) throws ServiceException {
        Upload upload = upload(owner, token); check(upload.session, true);
        if (upload.received != upload.size || upload.file.length() != upload.size)
            throw fail(Failure.INVALID_INPUT, "原件尚未完整传输");
        try {
            String actualHash = fileHash(upload.file);
            if (!upload.expectedHash.equals(actualHash)) throw fail(Failure.INVALID_INPUT, "原件校验失败，未上传服务");
            String mime = sniff(upload.file);
            if (mime == null) throw fail(Failure.INVALID_INPUT, "原件不是支持的 PNG/JPEG/GIF/WebP/AVIF 图片");
            JSONObject response = json(upload.session, true, "POST", "/api/chat-journal/media", null,
                upload.file, upload.name, mime, upload.lastModified);
            if (!safeId(response.optString("id")) || !mime.equals(response.optString("type"))
                || integer(response, "size", 1, MAX_BYTES) != upload.size
                || !actualHash.equals(response.optString("sha256")))
                throw fail(Failure.INVALID_RESPONSE, "服务原件回执校验失败，请保留本地原件后重新查询");
            check(upload.session, true); upload.session.media.put(response.getString("id"), copy(response));
            uploads.remove(token); upload.file.delete();
            return response;
        } catch (IOException ignored) { throw fail(Failure.STORAGE, "无法读取原件临时文件，本地素材已保留");
        } catch (JSONException ignored) { throw fail(Failure.INVALID_RESPONSE, "服务原件回执不正确"); }
    }

    public synchronized JSONObject uploadCancel(Object owner, String token) throws ServiceException {
        Upload upload = upload(owner, token); uploads.remove(token); upload.file.delete();
        return object("cancelled", true);
    }
    public synchronized void cancelOwner(Object owner) {
        Iterator<Upload> iterator = uploads.values().iterator();
        while (iterator.hasNext()) { Upload upload = iterator.next(); if (upload.owner == owner) { upload.file.delete(); iterator.remove(); } }
    }
    private void clearUploads() { for (Upload upload : uploads.values()) upload.file.delete(); uploads.clear(); }
    private Upload upload(Object owner, String token) throws ServiceException {
        Upload upload = uploads.get(token);
        if (owner == null || upload == null || upload.owner != owner) throw fail(Failure.INVALID_INPUT, "原件传输会话已失效");
        return upload;
    }

    private JSONObject media(Session session, String mediaId, long offset) throws ServiceException {
        JSONObject metadata = session.media.get(mediaId);
        if (metadata == null) throw fail(Failure.INVALID_INPUT, "请先读取收藏目录或有效媒体回执");
        long size = integer(metadata, "size", 1, Long.MAX_VALUE);
        if (size > MAX_BYTES) throw fail(Failure.TOO_LARGE, "旧收藏原件超过64 MiB，目录与本地素材已保留");
        String expectedMime = metadata.optString("type");
        if (!allowedMime(expectedMime) || offset >= size) throw fail(Failure.INVALID_INPUT, "图片类型或读取位置不正确");
        ReadProgress progress = session.reads.get(mediaId);
        if (progress != null && offset == progress.lastOffset && progress.signature.equals(metadata.toString())) {
            check(session, true); return copy(progress.lastResult);
        }
        if (offset == 0) {
            if (!session.reads.containsKey(mediaId) && session.reads.size() >= 8) {
                Iterator<ReadProgress> reads = session.reads.values().iterator();
                while (reads.hasNext()) { ReadProgress old = reads.next(); if (old.next == old.size) { reads.remove(); break; } }
                if (session.reads.size() >= 8) throw fail(Failure.INVALID_INPUT, "当前原件读取较多，请完成后重试");
            }
            progress = new ReadProgress(metadata); session.reads.put(mediaId, progress);
        }
        if (progress == null || offset != progress.next || !progress.signature.equals(metadata.toString()))
            throw fail(Failure.INVALID_INPUT, "请从首块按顺序读取原件");
        long end = Math.min(size - 1, offset + CHUNK_BYTES - 1);
        HttpURLConnection connection = null;
        try {
            connection = open(session, true, "GET", "/media/" + mediaId);
            connection.setRequestProperty("Range", "bytes=" + offset + "-" + end);
            int status = connection.getResponseCode(); check(session, true);
            if (status != 200 && status != 206) throw httpError(status);
            String mime = mime(connection.getContentType());
            if (!expectedMime.equals(mime) || !allowedMime(mime)) throw fail(Failure.INVALID_RESPONSE, "原件 MIME 与目录不一致");
            if (status == 206) {
                if (!("bytes " + offset + "-" + end + "/" + size).equals(connection.getHeaderField("Content-Range")))
                    throw fail(Failure.INVALID_RESPONSE, "原件范围与目录不一致");
            } else if (offset != 0 || size > CHUNK_BYTES) throw fail(Failure.INVALID_RESPONSE, "原件服务未按范围返回");
            byte[] bytes = read(connection, CHUNK_BYTES);
            if (bytes.length != end - offset + 1) throw fail(Failure.INVALID_RESPONSE, "原件分块长度不一致");
            if (offset == 0 && !expectedMime.equals(sniff(bytes, bytes.length)))
                throw fail(Failure.INVALID_RESPONSE, "原件实际格式与目录 MIME 不一致");
            check(session, true); progress.digest.update(bytes); progress.next = end + 1;
            JSONObject result = object("offset", offset, "mime", mime, "bytes", Base64.getEncoder().encodeToString(bytes));
            if (progress.next == size) {
                String actualHash = hex(progress.digest.digest()), expectedHash = metadata.optString("sha256", "");
                if (!expectedHash.isEmpty() && !expectedHash.equals("null") && !actualHash.equals(expectedHash)) {
                    session.reads.remove(mediaId); throw fail(Failure.INVALID_RESPONSE, "原件 SHA-256 与目录不一致，本地原件已保留");
                }
                result.put("sha256", actualHash);
            }
            check(session, true); progress.lastOffset = offset; progress.lastResult = copy(result); return result;
        } catch (IOException e) { throw ioError(e);
        } catch (JSONException ignored) { throw fail(Failure.INVALID_RESPONSE, "原件响应格式不正确");
        } finally { finishConnection(connection); }
    }

    private Session session() throws ServiceException {
        BackendServices.Snapshot current = backend.snapshot(); checkScope(current);
        Session session = connected;
        if (session == null) throw fail(Failure.OFFLINE, "收藏服务尚未明确连接，已有本地素材仍可使用");
        check(session, true); return session;
    }
    private void checkScope(BackendServices.Snapshot config) throws ServiceException {
        String pinned = getPinnedBaseUrl();
        if (!pinned.isEmpty() && !pinned.equals(config.baseUrl))
            throw fail(Failure.CONFLICT, "此收藏映射属于另一服务地址，原本地素材与映射已保留");
    }
    private void check(Session session, boolean requireConnected) throws ServiceException {
        backend.ensureCurrent(session.config); checkScope(session.config);
        if (session.epoch != lifecycle.get() || (requireConnected && connected != session))
            throw fail(Failure.CONFIG_CHANGED, "收藏服务连接已改变，请重新明确连接");
    }
    private HttpURLConnection open(Session session, boolean active, String method, String path) throws ServiceException, IOException {
        check(session, active);
        try {
            HttpURLConnection connection = (HttpURLConnection) new URI(session.config.baseUrl + path).toURL().openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(8000); connection.setReadTimeout(12000);
            connection.setUseCaches(false); connection.setRequestMethod(method);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("X-Diary-Client", "desktop"); // Existing source guard, NOT authentication.
            inFlight = connection; return connection;
        } catch (java.net.URISyntaxException ignored) { throw fail(Failure.INVALID_INPUT, "服务地址不正确"); }
    }
    private JSONObject json(Session session, boolean active, String method, String path, JSONObject body,
                            File file, String name, String mime) throws ServiceException {
        return json(session, active, method, path, body, file, name, mime, null);
    }
    private JSONObject json(Session session, boolean active, String method, String path, JSONObject body,
                            File file, String name, String mime, Long lastModified) throws ServiceException {
        HttpURLConnection connection = null;
        try {
            connection = open(session, active, method, path); connection.setRequestProperty("Accept", "application/json");
            if (body != null || file != null) {
                connection.setDoOutput(true);
                if (file != null) {
                    connection.setRequestProperty("Content-Type", mime);
                    connection.setRequestProperty("X-File-Name", URLEncoder.encode(name, "UTF-8").replace("+", "%20"));
                    if (lastModified != null) connection.setRequestProperty("X-File-Last-Modified", lastModified.toString());
                    connection.setFixedLengthStreamingMode(file.length());
                    try (InputStream in = new FileInputStream(file); OutputStream out = connection.getOutputStream()) {
                        byte[] chunk = new byte[32768]; int count;
                        while ((count = in.read(chunk)) != -1) { check(session, active); out.write(chunk, 0, count); }
                    }
                } else {
                    byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                    if (bytes.length > 64 * 1024) throw fail(Failure.TOO_LARGE, "收藏请求超出大小限制");
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                }
            }
            int status = connection.getResponseCode(); check(session, active);
            if (status < 200 || status >= 300) throw httpError(status);
            if (!"application/json".equals(mime(connection.getContentType())))
                throw fail(Failure.INVALID_RESPONSE, "收藏服务没有返回 JSON");
            JSONObject response = new JSONObject(new String(read(connection, JSON_LIMIT), StandardCharsets.UTF_8));
            check(session, active); return response;
        } catch (IOException e) { throw ioError(e);
        } catch (JSONException ignored) { throw fail(Failure.INVALID_RESPONSE, "收藏服务响应格式不正确");
        } finally { finishConnection(connection); }
    }
    private void finishConnection(HttpURLConnection connection) {
        if (connection != null) { connection.disconnect(); if (inFlight == connection) inFlight = null; }
    }
    private ServiceException httpError(int status) {
        if (status == 401) { lifecycle.incrementAndGet(); connected = null; }
        return BackendServices.httpError(status);
    }
    private static ServiceException ioError(IOException error) {
        if (error instanceof SocketTimeoutException) return fail(Failure.TIMEOUT, "收藏服务连接超时，请稍后重试");
        if (error instanceof SSLException) return fail(Failure.TLS, "收藏服务安全连接验证失败");
        return fail(Failure.NETWORK, "收藏服务连接失败，本地素材已保留");
    }
    private static byte[] read(HttpURLConnection connection, int limit) throws IOException, ServiceException {
        if (connection.getContentLengthLong() > limit) throw fail(Failure.TOO_LARGE, "服务响应超出大小限制");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = connection.getInputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > limit) throw fail(Failure.TOO_LARGE, "服务响应超出大小限制");
                out.write(buffer, 0, count);
            }
        }
        return out.toByteArray();
    }
    private static void validateSource(JSONObject source) throws ServiceException {
        if (source == null) throw fail(Failure.INVALID_INPUT, "缺少已确认的真实消息来源");
        if ("chat".equals(source.optString("kind"))) {
            fields(source, "kind", "sourceId", "roomId", "messageId");
            if (!text(source, "sourceId", 36, false).matches("[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
                || !text(source, "roomId", 21, false).matches("-?[0-9]{1,20}")
                || !text(source, "messageId", 20, false).matches("[0-9]{1,20}"))
                throw fail(Failure.INVALID_INPUT, "消息来源标识不正确，不能用本地 TL 编号替代");
        } else if ("unit".equals(source.optString("kind"))) {
            fields(source, "kind", "unitId", "revision"); text(source, "unitId", 500, false);
            integer(source, "revision", 1, 9007199254740991L);
        } else throw fail(Failure.INVALID_INPUT, "来源必须为已确认的 chat 或 unit");
    }
    private static boolean sameSource(JSONObject expected, JSONObject actual) {
        if (actual == null || expected.length() != actual.length()) return false;
        Iterator<String> keys = expected.keys();
        while (keys.hasNext()) { String key = keys.next(); if (!String.valueOf(expected.opt(key)).equals(String.valueOf(actual.opt(key)))) return false; }
        return true;
    }
    private static void metadata(JSONObject input) throws ServiceException {
        if (input.has("name")) text(input, "name", 250, false);
        if (input.has("group")) text(input, "group", 80, false);
        if (input.has("note")) text(input, "note", 2000, true);
    }
    private static void fields(JSONObject input, String... allowed) throws ServiceException {
        if (input == null) throw fail(Failure.INVALID_INPUT, "缺少收藏参数");
        Set<String> keys = new HashSet<>(Arrays.asList(allowed));
        Iterator<String> iterator = input.keys();
        while (iterator.hasNext()) if (!keys.contains(iterator.next())) throw fail(Failure.INVALID_INPUT, "收藏参数包含未知字段");
    }
    private static String text(JSONObject value, String key, int max, boolean empty) throws ServiceException {
        Object input = value.opt(key);
        if (!(input instanceof String) || ((String) input).length() > max || (!empty && ((String) input).trim().isEmpty()))
            throw fail(Failure.INVALID_INPUT, "收藏文字参数不正确");
        return (String) input;
    }
    private static long integer(JSONObject value, String key, long min, long max) throws ServiceException {
        Object input = value.opt(key); double number = input instanceof Number ? ((Number) input).doubleValue() : -1;
        if (!Double.isFinite(number) || Math.floor(number) != number || number < min || number > max)
            throw fail(Failure.INVALID_INPUT, "收藏长度、版本或偏移参数不正确");
        return ((Number) input).longValue();
    }
    private static boolean numberEquals(Object value, int expected) { return value instanceof Number && ((Number) value).doubleValue() == expected; }
    private static boolean safeId(String id) { return id != null && id.matches("[a-zA-Z0-9_-]{1,200}"); }
    private static String id(JSONObject input, String key) throws ServiceException {
        Object value = input.opt(key);
        if (!(value instanceof String) || !safeId((String) value)) throw fail(Failure.INVALID_INPUT, "收藏或媒体编号不正确");
        return (String) value;
    }
    private static String mime(String input) { return input == null ? "" : input.split(";", 2)[0].trim().toLowerCase(Locale.ROOT); }
    private static boolean allowedMime(String type) { return type.matches("image/(png|jpeg|gif|webp|avif)"); }
    private static String sniff(File file) throws IOException {
        byte[] bytes = new byte[512]; int size;
        try (InputStream in = new FileInputStream(file)) { size = in.read(bytes); }
        return sniff(bytes, size);
    }
    private static String sniff(byte[] bytes, int size) {
        if (size >= 8 && (bytes[0] & 255) == 137 && ascii(bytes, 1, 3).equals("PNG") && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10) return "image/png";
        if (size >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255) return "image/jpeg";
        if (size >= 6 && (ascii(bytes, 0, 6).equals("GIF87a") || ascii(bytes, 0, 6).equals("GIF89a"))) return "image/gif";
        if (size >= 12 && ascii(bytes, 0, 4).equals("RIFF") && ascii(bytes, 8, 4).equals("WEBP")) return "image/webp";
        if (size >= 16 && ascii(bytes, 4, 4).equals("ftyp")) {
            long boxSize = ((long) (bytes[0] & 255) << 24) | ((long) (bytes[1] & 255) << 16)
                | ((long) (bytes[2] & 255) << 8) | (bytes[3] & 255);
            int end = (int) Math.min(size, boxSize == 0 ? size : boxSize);
            if (end >= 16)
                for (int i = 8; i + 4 <= end; i += 4) if (i != 12 && (ascii(bytes, i, 4).equals("avif") || ascii(bytes, i, 4).equals("avis"))) return "image/avif";
        }
        return null;
    }
    private static String ascii(byte[] bytes, int offset, int count) { return new String(bytes, offset, count, StandardCharsets.US_ASCII); }
    private static MessageDigest digest() {
        try { return MessageDigest.getInstance("SHA-256"); } catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
    private static String fileHash(File file) throws IOException {
        MessageDigest digest = digest(); try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[32768]; int count; while ((count = in.read(bytes)) != -1) digest.update(bytes, 0, count);
        } return hex(digest.digest());
    }
    private static String hex(byte[] bytes) { StringBuilder out = new StringBuilder(); for (byte value : bytes) out.append(String.format(Locale.ROOT, "%02x", value & 255)); return out.toString(); }
    private static JSONObject object(Object... pairs) throws ServiceException {
        try { JSONObject result = new JSONObject(); for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); return result;
        } catch (JSONException ignored) { throw fail(Failure.INVALID_RESPONSE, "收藏响应格式不正确"); }
    }
    private static JSONObject copy(JSONObject value) throws ServiceException {
        try { return new JSONObject(value.toString()); } catch (JSONException ignored) { throw fail(Failure.INVALID_INPUT, "收藏参数格式不正确"); }
    }
    private static ServiceException fail(Failure kind, String message) { return BackendServices.error(kind, message); }
}
