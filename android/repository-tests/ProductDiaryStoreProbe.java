package dev.shiye.app;

import android.app.Instrumentation;
import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Isolated synthetic SQLite probe. Never opens the normal Shiye database. */
public final class ProductDiaryStoreProbe extends Instrumentation {
    private final JSONArray checks = new JSONArray();
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject(); Bundle finish = new Bundle();
        Context context = getTargetContext();
        try { run(context); report.put("ok", true); }
        catch (Throwable error) { try { report.put("ok", false).put("error", error.getClass().getSimpleName()+":"+error.getMessage()); } catch(Exception ignored) { } }
        try {
            report.put("checks", checks).put("count", checks.length()).put("synthetic", true);
            try(FileOutputStream out=context.openFileOutput("diary-result.json", Context.MODE_PRIVATE)) {
                out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
            }
            finish.putString("report", "diary-result.json");
        } catch(Exception error) { finish.putString("error", error.getClass().getSimpleName()); }
        finish(report.optBoolean("ok") ? 0 : 1, finish);
    }
    private void run(Context context) throws Exception {
        File file = new File(context.getFilesDir(), "product-diary-"+java.util.UUID.randomUUID()+".sqlite");
        SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null);
        try {
            ProductRepository repo = new ProductRepository(db); repo.initialize();
            ProductDiaryStore diaries = new ProductDiaryStore(repo);
            JSONObject fixture = asset(context, "fixture.json");
            JSONObject entry = null;
            JSONArray records = fixture.getJSONArray("records");
            for(int i=0;i<records.length();i++) if("journalAggregate".equals(records.getJSONObject(i).optString("entityType"))) { entry=records.getJSONObject(i); break; }
            if(entry==null) throw new Exception("fixture-entry-missing");
            String id = entry.getString("entityId");
            JSONObject prepared = new JSONObject().put("entityType", "journalAggregate").put("entityId", id)
                .put("data", new JSONObject(entry.getJSONObject("data").toString()));
            JSONObject first = diaries.save(prepared, new JSONArray().put("body"), 0);
            check("offline-local-only", first.getBoolean("localOnly") && first.getLong("localRevision")==1);
            check("unknown-preserved", diaries.read(id).getJSONObject("local").getJSONObject("data")
                .getJSONObject("futureExtension").getString("idLikeNumber").equals("9007199254740993"));
            check("canonical-preserved", diaries.read(id).getJSONObject("local").getJSONObject("data").getJSONObject("_canonical")
                .getJSONArray("units").length()>0);
            check("list-from-authority", diaries.list().length()==1 && diaries.list().getJSONObject(0).getString("id").equals(id));
            JSONObject metadata = new JSONObject(prepared.toString());
            metadata.getJSONObject("data").put("title", "修改标题").put("revision", 4)
                .put("updatedAt", "2025-10-17T02:00:00Z");
            JSONObject second = diaries.save(metadata, new JSONArray().put("title"), 1);
            check("metadata-local-revision", second.getLong("localRevision")==2);
            check("metadata-keeps-content-clock", second.getJSONObject("local").getJSONObject("data")
                .getString("contentEditedAt").equals(prepared.getJSONObject("data").getString("contentEditedAt")));
            JSONObject broken = new JSONObject(metadata.toString()); broken.getJSONObject("data").remove("futureExtension");
            failure("unknown-drop-rejected", () -> diaries.save(broken, new JSONArray().put("title"), 2));
            JSONObject html = new JSONObject(metadata.toString()); html.getJSONObject("data").put("contentFormat", "html");
            failure("html-downgrade-rejected", () -> diaries.save(html, new JSONArray().put("body"), 2));
            JSONObject identity = fixture.getJSONObject("identityExample");
            repo.bindIdentity(new JSONObject(identity.toString()).put("protocol", 1));
            JSONObject queued = diaries.queueLocalOnly(id, 2);
            check("local-only-explicit-queue", queued.has("operationId") && repo.pending().length()==1);
            JSONObject newer = new JSONObject(metadata.toString()); newer.getJSONObject("data").put("title", "排队后的新标题")
                .put("revision", 5).put("updatedAt", "2025-10-17T03:00:00Z");
            JSONObject third = diaries.save(newer, new JSONArray().put("title"), 3);
            check("pending-new-edit-preserved", third.getJSONObject("record").getLong("localRevision")==4 && repo.pending().length()==2);
            check("queued-wire-is-canonical", repo.prepareNextPush(identity).getJSONObject("wire").getJSONObject("data")
                .getJSONObject("_canonical").getJSONArray("units").length()>0);
            String newId = "fixture-legacy-entry";
            final JSONObject legacy = new JSONObject(prepared.toString().replace(id, newId));
            ProductDiaryStore legacyStore = new ProductDiaryStore(repo);
            JSONObject imported = legacyStore.preserveLegacyEntry(legacy, "old-local-row");
            check("one-entry-import-local-only", imported.getBoolean("localOnly") && repo.pending().length()==2);
            check("legacy-map-same-transaction", legacyStore.legacyMapping("old-local-row").getString("entityId").equals(newId));
            failure("legacy-repeat-rejected", () -> legacyStore.preserveLegacyEntry(legacy, "old-local-row"));
        } finally { db.close(); }
    }
    private static JSONObject asset(Context context, String name) throws Exception {
        try(InputStream in=context.getAssets().open(name)) {
            byte[] bytes=new byte[in.available()]; int length=0,n;
            while(length<bytes.length && (n=in.read(bytes,length,bytes.length-length))>0) length+=n;
            return new JSONObject(new String(bytes,0,length,StandardCharsets.UTF_8));
        }
    }
    private void check(String name, boolean value) throws Exception { if(!value) throw new Exception(name); checks.put(name); }
    @FunctionalInterface private interface Throwing { void run() throws Exception; }
    private void failure(String name, Throwing action) throws Exception {
        try { action.run(); throw new Exception(name+":did-not-fail"); }
        catch(IllegalArgumentException | IllegalStateException expected) { checks.put(name); }
    }
}
