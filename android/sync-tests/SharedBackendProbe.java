package dev.shiye.app;

import android.app.Instrumentation;
import android.os.Bundle;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.nio.charset.StandardCharsets;

/** Dedicated synthetic UID only. Does not contact a service unless an explicit HTTP base is supplied. */
public final class SharedBackendProbe extends Instrumentation {
    private final JSONArray checks = new JSONArray();
    private boolean http;
    private interface Work { void run() throws Exception; }
    private void check(String name, boolean ok) throws Exception {
        if (!ok) throw new Exception(name);
        checks.put(name);
    }
    private void invalid(String name, Work work) throws Exception {
        boolean rejected = false;
        try { work.run(); } catch (BackendServices.ServiceException e) { rejected = e.kind == BackendServices.Failure.INVALID_INPUT; }
        check(name, rejected);
    }
    @Override public void onCreate(Bundle args) { super.onCreate(args); http = args != null && "true".equals(args.getString("http")); start(); }
    @Override public void onStart() {
        JSONObject result = new JSONObject();
        try {
            final JSONArray calls = new JSONArray();
            JSONObject response = new JSONObject().put("futureDTO", new JSONObject().put("unknown", new JSONArray().put(7)));
            SharedBackendTransport transport = new SharedBackendTransport((method, path, body) -> {
                try { calls.put(new JSONObject().put("method", method).put("path", path).put("body", body)); }
                catch (Exception e) { throw BackendServices.error(BackendServices.Failure.INVALID_INPUT, "fixture"); }
                return response;
            });
            check("unknown-response-fields-retained", transport.info() == response);
            check("info-fixed-get-path", calls.getJSONObject(0).getString("path").equals("/api/shared/v1/info") && calls.getJSONObject(0).getString("method").equals("GET"));
            JSONObject input = new JSONObject().put("future", new JSONArray().put(new JSONObject().put("nested", true))).put("text", "原件");
            transport.snapshot(input); transport.pull(input);
            check("snapshot-fixed-post-path", calls.getJSONObject(1).getString("path").equals("/api/shared/v1/snapshot") && calls.getJSONObject(1).getString("method").equals("POST"));
            check("pull-fixed-post-path", calls.getJSONObject(2).getString("path").equals("/api/shared/v1/pull"));
            String operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
            transport.command("qa-library", "qa-epoch", operationId, "conversation-create", input);
            JSONObject wire = calls.getJSONObject(3).getJSONObject("body");
            String immutable = wire.toString();
            check("command-fixed-envelope", wire.length() == 5 && wire.getString("operationId").equals(operationId) && wire.getString("action").equals("conversation-create"));
            check("library-epoch-travel-with-command", wire.getString("libraryId").equals("qa-library") && wire.getString("epoch").equals("qa-epoch"));
            check("unknown-input-fields-retained", wire.getJSONObject("input").getJSONArray("future").getJSONObject(0).getBoolean("nested"));
            input.put("text", "caller mutated");
            check("caller-input-isolated", wire.toString().equals(immutable));
            transport.command("qa-library", "qa-epoch", operationId, "conversation-create", wire.getJSONObject("input"));
            check("retry-keeps-exact-wire", calls.getJSONObject(4).getJSONObject("body").toString().equals(immutable));
            invalid("arbitrary-action-rejected", () -> transport.command("qa-library", "qa-epoch", operationId, "/api/access", input));
            invalid("bad-operation-id-rejected", () -> transport.command("qa-library", "qa-epoch", "../escape", "entry-save", input));
            invalid("null-input-rejected", () -> transport.command("qa-library", "qa-epoch", operationId, "entry-save", null));
            JSONObject missingIdentity = new JSONObject(wire.toString()); missingIdentity.remove("libraryId");
            invalid("missing-library-rejected", () -> transport.command(missingIdentity));
            check("invalid-never-reaches-exchange", calls.length() == 5);
            transport.entityRead(input);transport.feedItemRead(input);transport.seedResolve(input);transport.seedRegister(input);
            for(int index=0;index<4;index++)check("new-fixed-route-"+index,calls.getJSONObject(5+index).getString("path").equals(new String[]{"/api/shared/v1/entity/read","/api/shared/v1/feed-item/read","/api/shared/v1/seed-resolve","/api/shared/v1/seed-register"}[index]));
            final int[] attempts = {0};
            SharedBackendTransport failing = new SharedBackendTransport((method, path, body) -> {
                attempts[0]++; throw BackendServices.httpError(409);
            });
            boolean conflict = false;
            try { failing.command("qa-library", "qa-epoch", operationId, "entry-save", input); }
            catch (BackendServices.ServiceException e) { conflict = e.kind == BackendServices.Failure.CONFLICT && e.httpStatus == 409; }
            check("conflict-propagated-without-retry", conflict && attempts[0] == 1);
            BackendServices backend = new BackendServices(getTargetContext());
            backend.saveBaseUrl("https://example.invalid");
            boolean unbound = false;
            try { backend.sharedCommand(operationId, "entry-save", input); }
            catch (BackendServices.ServiceException e) { unbound = e.kind == BackendServices.Failure.CONFIG_CHANGED; }
            check("convenience-command-never-adopts-unbound-library", unbound);
            BackendServices.Snapshot prior = backend.snapshot();
            backend.saveBaseUrl("https://other.invalid");
            boolean changed = false;
            try { backend.ensureCurrent(prior); }
            catch (BackendServices.ServiceException e) { changed = e.kind == BackendServices.Failure.CONFIG_CHANGED; }
            check("configuration-generation-invalidates-request", changed);
            final boolean[] guarded = {false};
            runOnMainSync(() -> { try { backend.sharedInfo(); } catch (BackendServices.ServiceException e) { guarded[0] = e.kind == BackendServices.Failure.MAIN_THREAD; } });
            check("main-thread-network-rejected", guarded[0]);
            backend.saveBaseUrl("");
            boolean offline = false;
            try { backend.sharedInfo(); } catch (BackendServices.ServiceException e) { offline = e.kind == BackendServices.Failure.OFFLINE; }
            check("offline-does-not-contact-server", offline);
            if (http) verifyHttp(backend);
            result.put("ok", true).put("checks", checks);
        } catch (Exception e) {
            try { result.put("ok", false).put("checks", checks).put("failure", e.getClass().getSimpleName() + ":" + e.getMessage()); } catch (Exception ignored) { }
        }
        try (FileOutputStream out = new FileOutputStream(new File(getTargetContext().getFilesDir(), "shared-result.json"))) { out.write(result.toString().getBytes(StandardCharsets.UTF_8)); }
        catch (Exception ignored) { }
        Bundle output = new Bundle(); output.putString("shared", result.toString()); finish(result.optBoolean("ok") ? -1 : 0, output);
    }

    private void verifyHttp(BackendServices backend) throws Exception {
        backend.saveBaseUrl("http://127.0.0.1:19421");
        JSONObject info = backend.sharedInfo();
        String libraryId = info.getString("libraryId"), epoch = info.getString("epoch");
        check("http-info-binds-same-business-store", info.getBoolean("sameBusinessStore"));
        JSONObject identity = new JSONObject().put("libraryId", libraryId).put("epoch", epoch).put("limit", 200);
        check("http-snapshot-fixed-route", backend.sharedSnapshot(identity).has("entities"));
        JSONObject entry = new JSONObject().put("title", "native shared diary").put("content", "<p>native original</p>")
            .put("contentFormat", "html").put("date", "2026-10-19T01:00:00.000Z").put("category", "日常")
            .put("tags", new JSONArray()).put("attachments", new JSONArray()).put("location", "").put("mood", "平静").put("weather", "晴");
        String op = UUID.randomUUID().toString();
        JSONObject created = backend.sharedCommand(op, "entry-create", entry);
        String id = created.getJSONObject("result").getString("id");
        JSONObject pc = pcRequest("/api/entries/" + id, "GET", null);
        check("http-native-write-visible-through-pc-old-api-same-id", pc.getString("id").equals(id) && pc.getString("title").equals("native shared diary"));
        JSONObject replay = backend.sharedCommand(op, "entry-create", entry);
        check("http-command-replay-no-duplicate-id", replay.getBoolean("replayed") && replay.getJSONObject("result").getString("id").equals(id));
        JSONObject changed = new JSONObject(entry.toString()).put("title", "different immutable intent");
        boolean reused = false;
        try { backend.sharedCommand(op, "entry-create", changed); }
        catch (BackendServices.ServiceException e) { reused = e.httpStatus == 409 && e.remoteCode.equals("SHARED_OPERATION_REUSED"); }
        check("http-operation-reuse-safe-machine-code", reused);
        long after = created.getJSONObject("info").getLong("seq");
        pc.put("title", "pc legacy changed title");
        pcRequest("/api/entries/" + id, "PUT", pc);
        JSONObject pull = backend.sharedPull(new JSONObject(identity.toString()).put("after", after));
        boolean received = false;
        JSONArray changes = pull.getJSONArray("changes");
        for (int i=0; i<changes.length(); i++) {
            JSONObject value = changes.getJSONObject(i);
            if (id.equals(value.optString("entityId")) && "pc legacy changed title".equals(value.getJSONObject("data").optString("title"))) received = true;
        }
        check("http-pc-old-write-arrives-native-pull", received);
        JSONObject room = backend.sharedCommand(UUID.randomUUID().toString(), "conversation-create", new JSONObject()
            .put("title", "native shared room").put("mode", "session").put("selfName", "我").put("category", "日常").put("idleHours", 5));
        String conversationId = room.getJSONObject("result").getString("conversationId");
        BackendServices other = new BackendServices(getTargetContext()); other.sharedInfo();
        JSONObject directory = other.sharedCommand(UUID.randomUUID().toString(), "conversation-list", new JSONObject()).getJSONObject("result");
        boolean sameRoom = false;
        for (int i=0; i<directory.getJSONArray("conversations").length(); i++)
            if (conversationId.equals(directory.getJSONArray("conversations").getJSONObject(i).optString("conversationId"))) sameRoom = true;
        check("http-second-native-client-reads-same-room-id", sameRoom);
        JSONObject config = new JSONObject().put("enabled", true).put("title", "synthetic assistant").put("kind", "ai")
            .put("sender", new JSONObject().put("name", "助手")).put("parameters", new JSONObject().put("future", new JSONObject().put("nested", new JSONArray().put("preserved"))));
        backend.sharedCommand(UUID.randomUUID().toString(), "service-settings-save", new JSONObject().put("conversationId", conversationId)
            .put("slotId", "assistant").put("providerId", "external-program").put("expectedBindingRevision", 0).put("expectedConfigRevision", 0).put("config", config));
        JSONObject settings = other.sharedCommand(UUID.randomUUID().toString(), "service-settings-read", new JSONObject().put("conversationId", conversationId).put("slotId", "assistant")).getJSONObject("result");
        check("http-unknown-nested-program-parameter-retained", settings.getJSONObject("config").getJSONObject("parameters").getJSONObject("future").getJSONArray("nested").getString(0).equals("preserved"));
        boolean wrongLibrary = false;
        try { backend.sharedCommand(new JSONObject().put("libraryId", UUID.randomUUID().toString()).put("epoch", epoch)
            .put("operationId", UUID.randomUUID().toString()).put("action", "entry-create").put("input", entry)); }
        catch (BackendServices.ServiceException e) { wrongLibrary = e.httpStatus == 409 && e.remoteCode.equals("SHARED_LIBRARY_MISMATCH"); }
        check("http-wrong-library-rejected-without-rebinding", wrongLibrary);
        // Stale full entry must retain its operation and produce an explicit conflict.
        boolean stale = false;
        try { backend.sharedCommand(UUID.randomUUID().toString(), "entry-save", new JSONObject().put("entryId", id).put("entry", pc)); }
        catch (BackendServices.ServiceException e) { stale = e.httpStatus == 409 && e.remoteCode.equals("SHARED_BUSINESS_CONFLICT"); }
        check("http-stale-entry-conflict-keeps-server-value", stale && pcRequest("/api/entries/" + id, "GET", null).getString("title").equals("pc legacy changed title"));
    }

    /** Synthetic PC peer for this probe only; no caller-provided origin. */
    private JSONObject pcRequest(String path, String method, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection)new URL("http://127.0.0.1:19421" + path).openConnection();
        try {
            c.setConnectTimeout(8000); c.setReadTimeout(12000); c.setInstanceFollowRedirects(false); c.setRequestMethod(method);
            c.setRequestProperty("X-Diary-Client", "desktop"); c.setRequestProperty("Content-Type", "application/json");
            if (body != null) { byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8); c.setDoOutput(true); c.setFixedLengthStreamingMode(bytes.length); try(java.io.OutputStream out=c.getOutputStream()){out.write(bytes);} }
            if(c.getResponseCode() < 200 || c.getResponseCode() >= 300) throw new Exception("pc-fixture-status-"+c.getResponseCode());
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>8*1024*1024)throw new Exception("pc-response-limit");out.write(bytes,0,n);}return new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}
        } finally {c.disconnect();}
    }
}

