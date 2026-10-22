package dev.shiye.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Looper;
import org.json.JSONException;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.HashMap;
import java.util.Map;
import javax.net.ssl.SSLException;

/** Fixed native service transport. Call all network methods on a worker thread.
 * Local snapshots are discovery metadata, never the authoritative diary/message store. */
public final class BackendServices {
    private static final Object CONFIG_LOCK = new Object();
    private static final String PREFS = "backend_services_v1";
    private static final int CONNECT_TIMEOUT_MS = 8000, READ_TIMEOUT_MS = 12000;
    private static final int RESPONSE_LIMIT = 8 * 1024 * 1024, REQUEST_LIMIT = 4 * 1024 * 1024;
    private static final int DISCOVERY_LIMIT = 2 * 1024 * 1024;
    private static final Set<String> ACTIONS = new HashSet<>(Arrays.asList(
        "status", "config", "tick", "feed", "source", "media", "context", "comment",
        "withdraw", "comments", "runner-status", "runner-start", "runner-stop"));
    private final SharedPreferences prefs;
    private final SharedPreferences authPrefs;
    // Session credentials remain process-local and are isolated by normalized service URL.
    private final Map<String, String> sessions = new HashMap<>();
    private Snapshot sharedBinding;
    private String sharedLibraryId, sharedEpoch;

    public enum Failure { INVALID_INPUT, OFFLINE, MAIN_THREAD, CONFIG_CHANGED, LOCKED,
        CONFLICT, FORBIDDEN, NOT_FOUND, HTTP, REDIRECT, TIMEOUT, TLS, NETWORK,
        TOO_LARGE, INVALID_RESPONSE, UNSUPPORTED, STORAGE }

    /** Safe for presentation; cause and remote response bodies are deliberately excluded. */
    public static final class ServiceException extends Exception {
        public final Failure kind;
        public final int httpStatus;
        public final String remoteCode;
        private ServiceException(Failure kind, String message, int status) {
            this(kind, message, status, "");
        }
        private ServiceException(Failure kind, String message, int status, String code) {
            super(message); this.kind = kind; this.httpStatus = status; this.remoteCode = code;
        }
    }

    public BackendServices(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        authPrefs = context.getApplicationContext().getSharedPreferences("shared_backend_credentials_v1", Context.MODE_PRIVATE);
    }

    public String getBaseUrl() {
        synchronized (CONFIG_LOCK) { return prefs.getString("baseUrl", ""); }
    }

    /** Empty means offline. HTTPS uses platform trust/hostname verification without overrides. */
    public static String normalizeBaseUrl(String input) throws ServiceException {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) return "";
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("https") && !scheme.equals("http")) || host.isEmpty()
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || uri.getPort() == 0 || uri.getPort() > 65535
                || (scheme.equals("http") && !host.equals("localhost") && !host.equals("127.0.0.1")))
                throw new IllegalArgumentException();
            String path = uri.getRawPath() == null ? "" : uri.getRawPath();
            // Reject ambiguous dot/encoded separators so a configured prefix cannot be escaped.
            if (path.contains("\\") || path.contains("//") || path.matches(".*(?i:%2e|%2f|%5c).*"))
                throw new IllegalArgumentException();
            for (String part : path.split("/"))
                if (part.equals(".") || part.equals("..")) throw new IllegalArgumentException();
            while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
            int port = uri.getPort();
            String authority = host + ((port == -1 || (scheme.equals("https") && port == 443)
                || (scheme.equals("http") && port == 80)) ? "" : ":" + port);
            return scheme + "://" + authority + path;
        } catch (Exception ignored) {
            throw error(Failure.INVALID_INPUT, "请输入 HTTPS 地址，或 localhost / 127.0.0.1 本机 HTTP 地址");
        }
    }

    /** Synchronous local transaction; callers should use a worker for disk I/O. No network/write API. */
    public String saveBaseUrl(String input) throws ServiceException {
        String normalized = normalizeBaseUrl(input);
        synchronized (CONFIG_LOCK) {
            if (normalized.equals(prefs.getString("baseUrl", ""))) return normalized;
            long generation = prefs.getLong("generation", 0) + 1;
            if (!prefs.edit().putString("baseUrl", normalized).putLong("generation", generation).commit())
                throw error(Failure.STORAGE, "服务地址保存失败，请重试");
        }
        return normalized;
    }

    /** Last successful snapshot for the CURRENT address, or null. Read/parse on a worker thread. */
    public JSONObject getCachedDiscovery() {
        synchronized (CONFIG_LOCK) {
            String base = prefs.getString("baseUrl", "");
            if (base.isEmpty()) return null;
            try {
                String raw = prefs.getString(cacheKey(base), null);
                if (raw != null && raw.getBytes(StandardCharsets.UTF_8).length > DISCOVERY_LIMIT) return null;
                JSONObject result = raw == null ? null : new JSONObject(raw);
                return result != null && base.equals(result.optString("baseUrl")) ? result : null;
            } catch (Exception ignored) { return null; }
        }
    }

    /** Full JSON wrapper: {baseUrl, fetchedAt(epoch ms), health, catalog}; unknown fields retained. */
    public JSONObject discover() throws ServiceException {
        Snapshot config = snapshot();
        JSONObject health = request(config, "GET", "/api/health", null, DISCOVERY_LIMIT);
        JSONObject capability = health.optJSONObject("conversationServices");
        Object version = capability == null ? null : capability.opt("version");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != 1)
            throw error(Failure.UNSUPPORTED, "服务未提供兼容的会话接口");
        JSONObject catalog = request(config, "GET", "/api/conversation-services", null, DISCOVERY_LIMIT);
        validateCatalog(catalog);
        try {
            JSONObject result = new JSONObject().put("baseUrl", config.baseUrl)
                .put("fetchedAt", System.currentTimeMillis()).put("health", health).put("catalog", catalog);
            String serialized = result.toString();
            if (serialized.getBytes(StandardCharsets.UTF_8).length > DISCOVERY_LIMIT)
                throw error(Failure.TOO_LARGE, "服务发现快照超出大小限制");
            synchronized (CONFIG_LOCK) {
                ensureCurrent(config);
                if (!prefs.edit().putString(cacheKey(config.baseUrl), serialized).commit())
                    throw error(Failure.STORAGE, "服务发现成功，但本地快照保存失败");
            }
            return result;
        } catch (JSONException ignored) { throw error(Failure.INVALID_RESPONSE, "服务响应格式不正确"); }
    }

    /** Fixed POST endpoint. Payload must be explicit; all scope/unknown response fields survive. */
    public JSONObject instanceRequest(String instanceId, String action, JSONObject payload) throws ServiceException {
        Snapshot config = snapshot();
        if (instanceId == null || !instanceId.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")
            || !ACTIONS.contains(action) || payload == null)
            throw error(Failure.INVALID_INPUT, "服务实例或操作参数不正确");
        try {
            JSONObject envelope = new JSONObject().put("instanceId", instanceId).put("action", action)
                .put("payload", new JSONObject(payload.toString()));
            JSONObject result = request(config, "POST", "/api/conversation-services/request", envelope, RESPONSE_LIMIT);
            JSONObject scope = result.optJSONObject("scope");
            if (scope == null || !instanceId.equals(scope.optString("instanceId")))
                throw error(Failure.INVALID_RESPONSE, "服务返回的实例范围不匹配");
            return result;
        } catch (JSONException ignored) { throw error(Failure.INVALID_INPUT, "操作参数格式不正确"); }
    }

    private SharedBackendTransport shared(Snapshot config) {
        return new SharedBackendTransport((method, path, input) ->
            request(config, method, path, input, RESPONSE_LIMIT));
    }

    /** Explicit discovery binds convenience commands to this library and configuration generation. */
    public JSONObject sharedInfo() throws ServiceException {
        Snapshot config = snapshot();
        JSONObject info = shared(config).info();
        if (!SharedBackendTransport.identity(info.opt("libraryId")) || !SharedBackendTransport.identity(info.opt("epoch")))
            throw error(Failure.INVALID_RESPONSE, "共享资料库身份不正确");
        synchronized (CONFIG_LOCK) {
            ensureCurrent(config); sharedBinding = config;
            sharedLibraryId = info.optString("libraryId"); sharedEpoch = info.optString("epoch");
        }
        return info;
    }
    public JSONObject sharedSnapshot(JSONObject input) throws ServiceException { return shared(snapshot()).snapshot(input); }
    public JSONObject sharedPull(JSONObject input) throws ServiceException { return shared(snapshot()).pull(input); }
    public JSONObject sharedMediaRead(JSONObject input) throws ServiceException { return shared(snapshot()).mediaRead(input); }
    public JSONObject sharedMediaBegin(JSONObject input) throws ServiceException { return shared(snapshot()).mediaBegin(input); }
    public JSONObject sharedMediaChunk(JSONObject input) throws ServiceException { return shared(snapshot()).mediaChunk(input); }
    public JSONObject sharedMediaComplete(JSONObject input) throws ServiceException { return shared(snapshot()).mediaComplete(input); }
    public JSONObject sharedEntityRead(JSONObject input) throws ServiceException { return shared(snapshot()).entityRead(input); }
    public JSONObject sharedFeedItemRead(JSONObject input) throws ServiceException { return shared(snapshot()).feedItemRead(input); }
    public JSONObject sharedSeedResolve(JSONObject input) throws ServiceException { return shared(snapshot()).seedResolve(input); }
    public JSONObject sharedSeedRegister(JSONObject input) throws ServiceException { return shared(snapshot()).seedRegister(input); }
    public JSONObject sharedCommand(String operationId, String action, JSONObject input) throws ServiceException {
        Snapshot config = snapshot();
        String libraryId, epoch;
        synchronized (CONFIG_LOCK) {
            if (sharedBinding == null || !sharedBinding.baseUrl.equals(config.baseUrl) || sharedBinding.generation != config.generation || sharedBinding.authGeneration != config.authGeneration)
                throw error(Failure.CONFIG_CHANGED, "请先明确读取共享资料库身份");
            libraryId = sharedLibraryId; epoch = sharedEpoch;
        }
        return shared(config).command(libraryId, epoch, operationId, action, input);
    }
    public JSONObject sharedCommand(JSONObject envelope) throws ServiceException { return shared(snapshot()).command(envelope); }

    /** Explicit user pairing only. The credential response never crosses the native boundary. */
    public JSONObject sharedPair(String code, String deviceName) throws ServiceException {
        if (code == null || code.isEmpty() || code.length() > 200 || deviceName == null || deviceName.trim().isEmpty() || deviceName.length() > 100)
            throw error(Failure.INVALID_INPUT, "配对参数不正确");
        Snapshot config = snapshot();
        try {
            JSONObject response = request(config, "POST", "/api/shared/v1/auth/pair", new JSONObject().put("code", code).put("deviceName", deviceName), RESPONSE_LIMIT);
            String device = response.optString("deviceId", ""), token = response.optString("token", ""), name = response.optString("deviceName", deviceName);
            if (!device.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}") || !token.matches("[a-f0-9]{64}") || name.length() > 100)
                throw error(Failure.INVALID_RESPONSE, "配对响应不正确");
            synchronized (CONFIG_LOCK) {
                ensureCurrent(config);
                String key = credentialKey(config.baseUrl);
                String priorDevice = authPrefs.getString(key+"_device", "");
                if (!authPrefs.edit().remove(key+"_"+priorDevice+"_token").putString(key+"_device", device).putString(key+"_"+device+"_token", token)
                    .putString(key+"_name", name).putLong(key+"_generation", config.authGeneration+1).commit())
                    throw error(Failure.STORAGE, "设备配对保存失败");
                sharedBinding = null;
            }
            return sharedAuthStatus();
        } catch (JSONException ignored) { throw error(Failure.INVALID_INPUT, "配对参数不正确"); }
    }

    /** Local metadata only: credentials are never serialized, even to a status/debug response. */
    public JSONObject sharedAuthStatus() throws ServiceException {
        synchronized (CONFIG_LOCK) {
            String base = prefs.getString("baseUrl", ""), key = credentialKey(base);
            String device = authPrefs.getString(key+"_device", "");
            boolean paired = !base.isEmpty() && !device.isEmpty() && authPrefs.getString(key+"_"+device+"_token", "").matches("[a-f0-9]{64}");
            try {
                JSONObject result = new JSONObject().put("paired", paired);
                if (paired) result.put("deviceId", device).put("deviceName", authPrefs.getString(key+"_name", ""));
                return result;
            } catch (JSONException ignored) { throw error(Failure.STORAGE, "设备状态读取失败"); }
        }
    }

    /** Local forget, not a claim of administrative server revocation. Invalidates in-flight work. */
    public JSONObject sharedForgetDevice() throws ServiceException {
        synchronized (CONFIG_LOCK) {
            String key = credentialKey(prefs.getString("baseUrl", "")), device = authPrefs.getString(key+"_device", "");
            if (!authPrefs.edit().remove(key+"_device").remove(key+"_"+device+"_token").remove(key+"_name")
                .putLong(key+"_generation", authPrefs.getLong(key+"_generation",0)+1).commit())
                throw error(Failure.STORAGE, "设备凭据清除失败");
            sharedBinding = null;
        }
        return sharedAuthStatus();
    }

    /** Existing server lock only. Password is never cached or included in an error. */
    public JSONObject sharedUnlock(String password) throws ServiceException {
        if (password == null || password.length() > 200)
            throw error(Failure.INVALID_INPUT, "解锁参数不正确");
        try { return request(snapshot(), "POST", "/api/unlock", new JSONObject().put("password", password), RESPONSE_LIMIT); }
        catch (JSONException ignored) { throw error(Failure.INVALID_INPUT, "解锁参数不正确"); }
    }

    static final class Snapshot {
        final String baseUrl; final long generation, authGeneration;
        Snapshot(String url, long generation, long authGeneration) { this.baseUrl = url; this.generation = generation; this.authGeneration = authGeneration; }
    }

    Snapshot snapshot() throws ServiceException {
        if (Looper.myLooper() == Looper.getMainLooper())
            throw error(Failure.MAIN_THREAD, "网络操作需要在后台执行");
        synchronized (CONFIG_LOCK) {
            String base = prefs.getString("baseUrl", "");
            if (base.isEmpty()) throw error(Failure.OFFLINE, "当前为离线模式，请先设置服务地址");
            return new Snapshot(normalizeBaseUrl(base), prefs.getLong("generation", 0), authPrefs.getLong(credentialKey(base)+"_generation",0));
        }
    }

    void ensureCurrent(Snapshot config) throws ServiceException {
        synchronized (CONFIG_LOCK) {
            if (!config.baseUrl.equals(prefs.getString("baseUrl", ""))
                || config.generation != prefs.getLong("generation", 0))
                throw error(Failure.CONFIG_CHANGED, "服务地址已更换，请重新读取");
            if (config.authGeneration != authPrefs.getLong(credentialKey(config.baseUrl)+"_generation",0))
                throw error(Failure.CONFIG_CHANGED, "设备授权已变化，请重新读取");
        }
    }

    private static void validateCatalog(JSONObject catalog) throws ServiceException {
        Object version = catalog.opt("version"), revision = catalog.opt("revision");
        if (!(version instanceof Number) || ((Number) version).doubleValue() != 1)
            throw error(Failure.UNSUPPORTED, "会话目录版本不兼容");
        double rev = revision instanceof Number ? ((Number) revision).doubleValue() : -1;
        if (!Double.isFinite(rev) || rev < 0 || rev > 9007199254740991d || Math.floor(rev) != rev
            || !(catalog.opt("providers") instanceof JSONArray)
            || !(catalog.opt("instances") instanceof JSONArray)
            || !(catalog.opt("bindings") instanceof JSONArray))
            throw error(Failure.INVALID_RESPONSE, "会话目录结构不正确");
    }

    private JSONObject request(Snapshot config, String method, String path, JSONObject body, int responseLimit) throws ServiceException {
        ensureCurrent(config);
        HttpURLConnection connection = null;
        String sentCookie;
        synchronized (CONFIG_LOCK) { sentCookie = sessions.get(config.baseUrl); }
        String sentToken = null, sentDevice = null;
        if (path.startsWith("/api/shared/v1/") && !path.startsWith("/api/shared/v1/auth/")) synchronized (CONFIG_LOCK) {
            String key = credentialKey(config.baseUrl);
            String device = authPrefs.getString(key+"_device", ""), token = authPrefs.getString(key+"_"+device+"_token", "");
            if (device.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}") && token.matches("[a-f0-9]{64}")) { sentDevice = device; sentToken = token; }
        }
        try {
            connection = (HttpURLConnection) new URI(config.baseUrl + path).toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (sentCookie != null) connection.setRequestProperty("Cookie", sentCookie);
            if (sentToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + sentToken);
                connection.setRequestProperty("X-Sync-Device-Id", sentDevice);
            }
            // Existing localhost source guard compatibility; this is NOT authentication.
            if (body != null) {
                connection.setRequestProperty("X-Diary-Client", "desktop");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                // The complete seed roster is bounded separately; ordinary business requests
                // must retain their existing 4 MiB ceiling.
                int requestLimit = ("/api/shared/v1/seed-resolve".equals(path) || "/api/shared/v1/seed-register".equals(path)) ? 34 * 1024 * 1024 : REQUEST_LIMIT;
                if (bytes.length > requestLimit) throw error(Failure.TOO_LARGE, "请求内容超出大小限制");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            ensureCurrent(config);
            if (status < 200 || status >= 300) {
                if (status == 401) synchronized (CONFIG_LOCK) {
                    if (java.util.Objects.equals(sentCookie, sessions.get(config.baseUrl))) sessions.remove(config.baseUrl);
                }
                ServiceException basic = httpError(status);
                String code = "";
                // Bound parsing and expose only machine codes; never propagate a remote message/body.
                try (InputStream in = connection.getErrorStream()) {
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] chunk = new byte[1024]; int n;
                        while ((n = in.read(chunk)) != -1) {
                            if (out.size() + n > 16384) break;
                            out.write(chunk, 0, n);
                        }
                        JSONObject failure = new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
                        JSONObject nested = failure.optJSONObject("error");
                        String candidate = (nested == null ? failure : nested).optString("code", "");
                        if (candidate.matches("[A-Z][A-Z0-9_]{0,95}")) code = candidate;
                    }
                } catch (Exception ignored) { }
                ensureCurrent(config);
                if (status == 401 && "DEVICE_UNAUTHORIZED".equals(code) && sentToken != null) synchronized (CONFIG_LOCK) {
                    String key = credentialKey(config.baseUrl);
                    if (sentDevice.equals(authPrefs.getString(key+"_device", "")) && sentToken.equals(authPrefs.getString(key+"_"+sentDevice+"_token", ""))) {
                        if (!authPrefs.edit().remove(key+"_device").remove(key+"_"+sentDevice+"_token").remove(key+"_name")
                            .putLong(key+"_generation",config.authGeneration+1).commit()) throw error(Failure.STORAGE, "失效设备凭据清除失败");
                        sharedBinding = null;
                    }
                }
                throw new ServiceException(basic.kind, basic.getMessage(), status, code);
            }
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(Locale.ROOT).split(";", 2)[0].trim().equals("application/json"))
                throw error(Failure.INVALID_RESPONSE, "服务没有返回 JSON 数据");
            if (connection.getContentLengthLong() > responseLimit)
                throw error(Failure.TOO_LARGE, "服务响应超出大小限制");
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] chunk = new byte[8192]; int count;
                while ((count = in.read(chunk)) != -1) {
                    if (buffer.size() + count > responseLimit)
                        throw error(Failure.TOO_LARGE, "服务响应超出大小限制");
                    buffer.write(chunk, 0, count);
                }
            }
            JSONObject result = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            ensureCurrent(config);
            String cookie = connection.getHeaderField("Set-Cookie");
            if (cookie != null) {
                String pair = cookie.split(";", 2)[0].trim();
                if (pair.matches("diary_session=(?:[a-f0-9]{64})?")) synchronized (CONFIG_LOCK) {
                    ensureCurrent(config);
                    if (pair.equals("diary_session=")) sessions.remove(config.baseUrl);
                    else sessions.put(config.baseUrl, pair);
                }
            }
            return result;
        } catch (SocketTimeoutException ignored) { throw error(Failure.TIMEOUT, "连接服务超时，请稍后重试");
        } catch (SSLException ignored) { throw error(Failure.TLS, "安全连接验证失败，请检查服务证书");
        } catch (IOException ignored) { throw error(Failure.NETWORK, "无法连接服务，请检查地址和网络");
        } catch (JSONException ignored) { throw error(Failure.INVALID_RESPONSE, "服务响应格式不正确");
        } catch (java.net.URISyntaxException ignored) { throw error(Failure.INVALID_INPUT, "服务地址格式不正确");
        } finally { if (connection != null) connection.disconnect(); }
    }

    static ServiceException httpError(int status) {
        Failure kind = status == 401 ? Failure.LOCKED : status == 409 ? Failure.CONFLICT
            : status == 403 ? Failure.FORBIDDEN : status == 404 ? Failure.NOT_FOUND
            : status >= 300 && status < 400 ? Failure.REDIRECT : Failure.HTTP;
        String message = kind == Failure.LOCKED ? "服务已锁定，请在电脑端解锁后重试"
            : kind == Failure.CONFLICT ? "服务配置发生冲突，请重新读取后重试"
            : kind == Failure.FORBIDDEN ? "服务拒绝访问，请检查接入配置"
            : kind == Failure.NOT_FOUND ? "服务或实例不存在，请重新发现服务"
            : kind == Failure.REDIRECT ? "服务地址发生跳转，请直接设置最终地址"
            : "服务请求失败（HTTP " + status + "）";
        return new ServiceException(kind, message, status);
    }

    static ServiceException error(Failure kind, String message) {
        return new ServiceException(kind, message, 0);
    }

    private static String cacheKey(String base) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(base.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder("discovery_");
            for (byte value : digest) result.append(String.format(Locale.ROOT, "%02x", value & 255));
            return result.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
    private static String credentialKey(String base) { return "auth_" + cacheKey(base); }
}
