package dev.shiye.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;

/** Isolated, offline Android prototype. Richdoc JSON is the sole editable body. */
public final class LocalStore {
    private static final int BODY_LIMIT = 2 * 1024 * 1024;
    private static final int ENTRY_BODY_LIMIT = 2000000;
    private static final int MEDIA_LIMIT = 20 * 1024 * 1024;
    private static final String CHAT_PREFERENCES_KEY = "android-chat-ui-preferences-v1";
    private static final String WRITING_PREFERENCES_KEY = "android-diary-writing-preferences-v1";
    static final java.time.ZoneId DIARY_TIME_ZONE = java.time.ZoneId.of("Asia/Shanghai");
    private static final String ENTRY_DRAFT_PREFIX = "draft:";
    private static final DateTimeFormatter UTC_TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT).withZone(ZoneOffset.UTC);
    private final SQLiteDatabase db;
    private final File mediaDir;
    private final ProductRepository productRepository;

    @FunctionalInterface public interface ProductWork<T> { T run(ProductRepository repository) throws Exception; }
    /** Repository-only callback on the same connection; never perform network inside it. */
    public synchronized <T> T withProduct(ProductWork<T> work) throws Exception {
        return work.run(productRepository);
    }

    public static final class StoreException extends Exception {
        public final String code;
        public final JSONObject current;
        StoreException(String code, String message) { this(code, message, null); }
        StoreException(String code, String message, JSONObject current) {
            super(message); this.code = code; this.current = current;
        }
    }

    public LocalStore(Context context) throws Exception {
        mediaDir = new File(context.getFilesDir(), "media");
        if (!mediaDir.isDirectory() && !mediaDir.mkdirs()) throw new Exception("无法建立媒体目录");
        SQLiteOpenHelper helper = new SQLiteOpenHelper(context, "shiye-local-v1.db", null, 4) {
            @Override public void onConfigure(SQLiteDatabase database) {
                database.setForeignKeyConstraintsEnabled(true);
                try (Cursor pragma = database.rawQuery("PRAGMA secure_delete=ON", null)) {
                    if (!pragma.moveToFirst() || pragma.getInt(0) != 1)
                        throw new IllegalStateException("无法启用安全删除");
                }
            }
            @Override public void onCreate(SQLiteDatabase database) {
                database.execSQL("CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT NOT NULL)");
                database.execSQL("CREATE TABLE entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL,categoryId TEXT REFERENCES categories(id),tags TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,contentEditedAt TEXT)");
                database.execSQL("CREATE TABLE rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,categoryId TEXT REFERENCES categories(id),draft TEXT NOT NULL DEFAULT '',draftReplyTo TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL)");
                database.execSQL("CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,importedAt TEXT NOT NULL)");
                database.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY,roomId TEXT NOT NULL REFERENCES rooms(id),clientId TEXT NOT NULL,body TEXT,eventTime TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,replyTo TEXT REFERENCES messages(id),assetId TEXT REFERENCES assets(id),UNIQUE(roomId,clientId))");
                database.execSQL("CREATE INDEX messages_room_time ON messages(roomId,eventTime,id)");
                database.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
            }
            @Override public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
                if(oldVersion<1||oldVersion>4||newVersion!=4)throw new IllegalStateException("需要显式的数据库迁移");
                if(oldVersion<2)database.execSQL("ALTER TABLE entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
                if(oldVersion<3){
                    database.execSQL("ALTER TABLE entries ADD COLUMN contentEditedAt TEXT");
                    // This new column alone is backfilled. Existing body, revision and clocks stay untouched.
                    database.execSQL("UPDATE entries SET contentEditedAt=updatedAt");
                }
            }
        };
        db = helper.getWritableDatabase();
        // Additive product tables preserve full remote envelopes; legacy UI remains its
        // existing authority until its explicit, separately tested projection migration.
        productRepository = new ProductRepository(db);
        productRepository.initialize();
        db.beginTransaction();
        try {
            if (!exists("meta", "key", "seeded")) {
                seed();
                ContentValues marker = new ContentValues(); marker.put("key", "seeded"); marker.put("value", "synthetic-v1");
                db.insertOrThrow("meta", null, marker);
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }

    /** Caller owns threading; all requests are serialised and committed atomically. */
    public synchronized JSONObject dispatch(JSONObject request) throws Exception {
        if (request == null || request.toString().length() > BODY_LIMIT + 65536) invalid("请求过大或无效");
        String op = string(request, "op", 80, false);
        // ProductDiaryStore owns its complete SQLite transaction. Do not nest it in the
        // legacy dispatch transaction or acknowledge a save before its outbox commits.
        if ("productEntryGet".equals(op)) return productEntryGet(id(request, "id"));
        if ("productEntrySave".equals(op)) return productEntrySave(request);
        if ("setEntryPinned".equals(op) || "deleteEntry".equals(op)) {
            JSONObject product = productRepository.load("journalAggregate", id(request, "id"));
            if (product != null) return productEntryMetadata(request, product, "setEntryPinned".equals(op));
        }
        if ("saveEntry".equals(op) && productRepository.load("journalAggregate", id(request, "id")) != null)
            throw new StoreException("product_authority", "此篇日记已由产品资料库保存，请使用完整正文写口");
        db.beginTransaction();
        try {
            JSONObject result;
            switch (op) {
                case "bootstrap": result = bootstrap(); break;
                case "getEntry": result = getEntryForDisplay(id(request, "id")); break;
                case "getSuggestedTitle": result = getSuggestedTitle(request); break;
                case "saveSuggestedTitleFormats": result = saveSuggestedTitleFormats(request); break;
                case "createEntry": result = createEntry(request); break;
                case "createEntryDraft": result = createEntryDraft(request); break;
                case "discardEmptyEntryDraft": result = discardEmptyEntryDraft(request); break;
                case "saveEntry": result = saveEntry(request); break;
                case "saveEntryDraft": result = saveEntryDraft(request); break;
                case "setEntryPinned": result = setEntryPinned(request); break;
                case "deleteEntry": result = deleteEntry(request); break;
                case "createCategory": result = createCategory(request); break;
                case "renameCategory": result = renameCategory(request); break;
                case "deleteCategory": result = deleteCategory(request); break;
                case "getWritingPreferences": result = writingPreferences(); break;
                case "saveWritingPreferences": result = saveWritingPreferences(request); break;
                case "saveCategoryOrder": result = saveCategoryOrder(request); break;
                case "createRoom": result = createRoom(request); break;
                case "getRoom": result = getRoom(id(request, "id")); break;
                case "renameRoom": result = renameRoom(request); break;
                case "getMessages": result = getMessages(request); break;
                case "saveDraft": result = saveDraft(request); break;
                case "sendMessage": result = sendMessage(request); break;
                case "withdrawMessage": result = withdrawMessage(request); break;
                case "exportSnapshot": result = exportSnapshot(); break;
                case "getAndroidChatPreferences": result = getAndroidChatPreferences(); break;
                case "saveAndroidChatPreferences": result = saveAndroidChatPreferences(request); break;
                default: throw new StoreException("invalid", "不支持此操作");
            }
            db.setTransactionSuccessful();
            return result;
        } finally { db.endTransaction(); }
    }

    public synchronized void close() { db.close(); }

    private JSONObject getAndroidChatPreferences() throws Exception {
        try (Cursor c = db.rawQuery("SELECT value FROM meta WHERE key=?", new String[]{CHAT_PREFERENCES_KEY})) {
            return new JSONObject().put("value", c.moveToFirst() ? new JSONObject(c.getString(0)) : JSONObject.NULL);
        }
    }

    private JSONObject saveAndroidChatPreferences(JSONObject request) throws Exception {
        if (!request.has("value")) invalid("缺少置顶偏好");
        if (request.isNull("value")) {
            // Reset is scoped to this one known preference, never diary/message data.
            db.delete("meta", "key=?", new String[]{CHAT_PREFERENCES_KEY});
            return new JSONObject().put("value", JSONObject.NULL);
        }
        JSONObject value = request.optJSONObject("value");
        if (value == null || value.toString().length() > 65536 || value.optInt("version", -1) != 1)
            invalid("置顶偏好格式无效");
        JSONArray pins = value.optJSONArray("pinIds");
        if (pins == null || pins.length() > 10000) invalid("置顶偏好格式无效");
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < pins.length(); i++) {
            Object pin = pins.get(i);
            if (!(pin instanceof String) || ((String)pin).isEmpty() || ((String)pin).length() > 128 || !seen.add((String)pin))
                invalid("置顶会话编号无效");
        }
        ContentValues row = new ContentValues();
        row.put("key", CHAT_PREFERENCES_KEY);
        row.put("value", value.toString());
        if (db.insertWithOnConflict("meta", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new StoreException("storage", "置顶偏好未保存");
        return new JSONObject().put("value", new JSONObject(value.toString()));
    }

    private JSONObject bootstrap() throws Exception {
        JSONArray entries = new JSONArray(), rooms = new JSONArray(), categories = new JSONArray();
        try (Cursor c = db.rawQuery("SELECT * FROM entries WHERE deleted=0 ORDER BY date DESC,updatedAt DESC,id", null)) {
            while (c.moveToNext()) entries.put(entry(c, false));
        }
        // Replace an old row's display projection when a product record with the same ID
        // exists. The old row stays untouched as a readable preservation copy.
        JSONArray productRecords = productRepository.inCurrentTransaction(tx -> tx.listEntities());
        for (int p = 0; p < productRecords.length(); p++) {
            JSONObject record = productRecords.getJSONObject(p);
            if (!"journalAggregate".equals(record.optString("entityType"))) continue;
            JSONObject local = record.optJSONObject("local");
            if (local == null) continue;
            String productId = record.getString("entityId");
            for (int i = entries.length() - 1; i >= 0; i--)
                if (productId.equals(entries.getJSONObject(i).optString("id"))) entries.remove(i);
            if (!"active".equals(local.optString("state"))) continue;
            JSONObject data = local.optJSONObject("data");
            if (data == null || data.optBoolean("deleted")) continue;
            entries.put(productListEntry(record));
        }
        List<JSONObject> orderedEntries = new ArrayList<>();
        for (int i = 0; i < entries.length(); i++) orderedEntries.add(entries.getJSONObject(i));
        orderedEntries.sort((a,b) -> {
            int date = b.optString("date", "").compareTo(a.optString("date", ""));
            if (date != 0) return date;
            int edited = b.optString("updatedAt", "").compareTo(a.optString("updatedAt", ""));
            return edited != 0 ? edited : a.optString("id", "").compareTo(b.optString("id", ""));
        });
        entries = new JSONArray(); for (JSONObject item : orderedEntries) entries.put(item);
        try (Cursor c = db.rawQuery("SELECT * FROM rooms ORDER BY updatedAt DESC,id", null)) {
            while (c.moveToNext()) rooms.put(room(c));
        }
        try (Cursor c = db.rawQuery("SELECT * FROM categories ORDER BY rowid", null)) {
            while (c.moveToNext()) categories.put(new JSONObject().put("id", value(c,"id")).put("name", value(c,"name")));
        }
        for (int p = 0; p < productRecords.length(); p++) {
            JSONObject record = productRecords.getJSONObject(p);
            if (!"taxonomy".equals(record.optString("entityType"))) continue;
            JSONObject local = record.optJSONObject("local"), data = local == null ? null : local.optJSONObject("data");
            if (data == null || !"active".equals(local.optString("state")) || !"category".equals(data.optString("kind"))) continue;
            String taxonomyId = record.getString("entityId");
            for (int i = categories.length()-1; i >= 0; i--)
                if (taxonomyId.equals(categories.getJSONObject(i).optString("id"))) categories.remove(i);
            categories.put(new JSONObject().put("id", taxonomyId).put("productId", taxonomyId).put("name", data.optString("name")));
        }
        JSONObject preferences=writingPreferences();JSONArray sorted=new JSONArray(),order=preferences.getJSONArray("categoryOrder");
        Set<String> placedCategories = new HashSet<>();
        for(int i=0;i<order.length();i++)for(int j=0;j<categories.length();j++)
            if(order.getString(i).equals(categories.getJSONObject(j).getString("id"))){sorted.put(categories.getJSONObject(j));placedCategories.add(order.getString(i));break;}
        for(int j=0;j<categories.length();j++)
            if(placedCategories.add(categories.getJSONObject(j).getString("id"))) sorted.put(categories.getJSONObject(j));
        return new JSONObject().put("entries", entries).put("rooms", rooms).put("categories", sorted)
                .put("writingPreferences", preferences)
                .put("seededDemo",true).put("seedProvenance","synthetic-v1");
    }

    private JSONObject productEntryGet(String entryId) throws Exception {
        JSONObject record = new ProductDiaryStore(productRepository).read(entryId);
        if (record == null) return new JSONObject().put("entry", getEntry(entryId, false))
            .put("record", JSONObject.NULL).put("localRevision", 0).put("legacy", true)
            .put("readOnly", false).put("sourceId", productChatSourceId())
            .put("media", productEntryMedia(getEntry(entryId, false)));
        return productEntryView(record).put("sourceId", productChatSourceId())
            .put("media", productEntryMedia(record.getJSONObject("local").getJSONObject("data")));
    }

    private JSONObject productEntrySave(JSONObject request) throws Exception {
        JSONObject prepared = request.optJSONObject("preparedRecord");
        JSONArray dirty = request.optJSONArray("dirtyFields");
        if (prepared == null || dirty == null || !(request.opt("expectedLocalRevision") instanceof Number))
            throw new StoreException("invalid", "缺少完整准备记录或本地版本");
        long revision = request.getLong("expectedLocalRevision");
        ProductDiaryStore diaries = new ProductDiaryStore(productRepository);
        JSONObject saved;
        if (request.opt("legacyId") instanceof String && diaries.read(prepared.optString("entityId")) == null) {
            if (revision != 0) throw new StoreException("conflict", "旧日记首次保存须使用本地版本0");
            if (!prepared.optString("entityId").equals(request.getString("legacyId")))
                throw new StoreException("invalid", "旧日记身份不能在保存时改变");
            JSONObject old = getEntry(request.getString("legacyId"), false);
            JSONObject data = prepared.getJSONObject("data");
            if (old.optBoolean("draftOnly") && (!(request.opt("draftBaseRevision") instanceof Number) || request.getDouble("draftBaseRevision") != old.getInt("revision")))
                throw new StoreException("conflict","新草稿已更新，请保留当前内容并重试",old);
            if (old.optBoolean("draftOnly") && !hasEntryContent(data.optString("title", ""), data.getJSONObject("body")))
                return new JSONObject().put("entry", old).put("record", JSONObject.NULL)
                    .put("localRevision", 0).put("legacy", true).put("readOnly", false)
                    .put("emptyDraft", true).put("sourceId", productChatSourceId());
            saved = diaries.preserveLegacyEntry(prepared, request.getString("legacyId"));
        } else saved = diaries.save(prepared, dirty, revision);
        JSONObject record = saved.optJSONObject("record") == null ? saved : saved.getJSONObject("record");
        JSONObject result = productEntryView(record);
        if (saved.has("operationId")) result.put("operationId", saved.getString("operationId"));
        return result.put("sourceId", productChatSourceId())
            .put("media", productEntryMedia(record.getJSONObject("local").getJSONObject("data")));
    }

    private <T> T readProduct(ProductRepository.Work<T> work) throws Exception {
        return db.inTransaction()?productRepository.inCurrentTransaction(work):productRepository.transaction(work);
    }

    /** Read metadata from the old asset table or the received product media relation. */
    private JSONArray productEntryMedia(JSONObject data) throws Exception {
        Set<String> ids = new HashSet<>();
        JSONObject body = data.optJSONObject("body");
        if (body != null) collectBodyAttachments(body.optJSONArray("content"), ids);
        JSONArray attachments = data.optJSONArray("attachments");
        if (attachments != null) for (int i = 0; i < attachments.length(); i++) {
            Object ref = attachments.opt(i);
            if (ref instanceof String) ids.add((String) ref);
        }
        JSONArray media = new JSONArray();
        for (String assetId : ids) {
            try { media.put(getAsset(assetId)); }
            catch (StoreException missing) {
                if (!"not_found".equals(missing.code)) throw missing;
                JSONObject relation = readProduct(tx -> {
                    JSONObject direct = tx.getEntity("relation", assetId);
                    JSONObject candidate = null;
                    if (direct != null) {
                        JSONObject local = direct.optJSONObject("local");
                        JSONObject value = local == null ? null : local.optJSONObject("data");
                        JSONObject product = value == null ? null : value.optJSONObject("_product");
                        JSONObject refs = product == null ? null : product.optJSONObject("refs");
                        if (local != null && product != null && "active".equals(local.optString("state")) && "media".equals(product.optString("kind"))
                                && (refs == null || !refs.has("asset") || assetId.equals(refs.optString("asset")))) candidate = value;
                    }
                    if (candidate != null) return candidate;
                    JSONArray records = tx.listEntities();
                    for (int i = 0; i < records.length(); i++) {
                        JSONObject record = records.optJSONObject(i);
                        if (record == null || !"relation".equals(record.optString("entityType"))) continue;
                        JSONObject local = record.optJSONObject("local");
                        JSONObject value = local == null ? null : local.optJSONObject("data");
                        JSONObject product = value == null ? null : value.optJSONObject("_product");
                        JSONObject refs = product == null ? null : product.optJSONObject("refs");
                        if (local == null || !"active".equals(local.optString("state")) || product == null
                                || !"media".equals(product.optString("kind")) || refs == null
                                || !assetId.equals(refs.optString("asset"))) continue;
                        if (candidate != null) return null; // Ambiguous mapping is not media availability.
                        candidate = value;
                    }
                    return candidate;
                });
                if (relation == null) continue;
                String mime = relation.optString("mime", "");
                if (mime.isEmpty()) mime = relation.optString("type", "");
                if (mime.isEmpty()) continue;
                JSONObject projected = new JSONObject().put("id", assetId).put("mime", mime).put("type", mime);
                for (String key : new String[]{"name", "size", "sha256", "importedAt", "lastModified"})
                    if (relation.has(key) && !relation.isNull(key)) projected.put(key, relation.get(key));
                media.put(projected);
            }
        }
        return media;
    }

    private String productChatSourceId() throws Exception {
        return readProduct(tx -> {
            JSONObject meta = tx.getMeta(); String source = meta.optString("chatSourceId019", "");
            if (source.isEmpty()) { source = UUID.randomUUID().toString(); meta.put("chatSourceId019", source); tx.setMeta(meta); }
            return source;
        });
    }

    /** Native list controls retain the complete prepared body and canonical identity. */
    private JSONObject productEntryMetadata(JSONObject request, JSONObject record, boolean pin) throws Exception {
        JSONObject local = record.optJSONObject("local"), data = local == null ? null : local.optJSONObject("data");
        if (data == null || !"active".equals(local.optString("state")))
            throw new StoreException("product_read_only", "正文原件不可编辑");
        if (!"richdoc".equals(data.optString("contentFormat")) || data.optJSONObject("_canonical") == null)
            throw new StoreException("product_read_only", "此篇日记须保留原格式只读");
        if (!(request.opt("baseRevision") instanceof Number) || request.getLong("baseRevision") != data.optLong("revision", -1))
            throw new StoreException("conflict", "日记已在别处修改，请重新载入", productEntryView(record).getJSONObject("entry"));
        JSONObject preparedData = new JSONObject(data.toString());
        String field = pin ? "pinned" : "deleted";
        if (pin && !(request.opt("pinned") instanceof Boolean))
            throw new StoreException("invalid", "置顶状态须为布尔值");
        preparedData.put(field, pin ? request.getBoolean("pinned") : true);
        long revision = data.getLong("revision");
        if (revision >= Integer.MAX_VALUE) throw new StoreException("storage", "日记版本已超出支持范围");
        preparedData.put("revision", revision + 1).put("updatedAt", now());
        JSONObject prepared = new JSONObject().put("entityType", "journalAggregate")
            .put("entityId", record.getString("entityId")).put("data", preparedData);
        JSONObject saved = new ProductDiaryStore(productRepository).save(prepared, new JSONArray().put(field), record.getLong("localRevision"));
        JSONObject current = saved.optJSONObject("record") == null ? saved : saved.getJSONObject("record");
        JSONObject result = productEntryView(current).getJSONObject("entry");
        if (!pin) result.put("deleted", true);
        return result;
    }

    private JSONObject productEntryView(JSONObject record) throws Exception {
        JSONObject local = record.optJSONObject("local");
        JSONObject data = local == null ? null : local.optJSONObject("data");
        if (data == null) return new JSONObject().put("entry", JSONObject.NULL).put("record", record)
            .put("localRevision", record.getLong("localRevision")).put("readOnly", true)
            .put("reason", "正文原件尚未就绪或已撤回");
        JSONObject entry = new JSONObject(data.toString());
        entry.remove("_product"); entry.remove("_canonical");
        boolean readOnly = !"richdoc".equals(entry.optString("contentFormat")) ||
            entry.optJSONObject("body") == null || !"shiye-richdoc".equals(entry.getJSONObject("body").optString("format")) ||
            entry.optJSONObject("messageUnits") == null || !"messageStore".equals(entry.getJSONObject("messageUnits").optString("authority")) ||
            data.optJSONObject("_canonical") == null;
        JSONObject refs = data.optJSONObject("_product") == null ? null : data.getJSONObject("_product").optJSONObject("refs");
        Object stableCategory = refs == null ? null : refs.opt("category");
        Object displayCategory = stableCategory instanceof String ? stableCategory : entry.opt("categoryId");
        entry.put("categoryId", displayCategory == null ? JSONObject.NULL : displayCategory);
        return new JSONObject().put("entry", entry).put("record", record)
            .put("localRevision", record.getLong("localRevision"))
            .put("legacy", false).put("readOnly", readOnly)
            .put("reason", readOnly ? "当前正文格式或规范单元未完整接入，原件只读" : "")
            .put("categoryId", entry.opt("categoryId"))
            .put("categoryRef", stableCategory == null ? JSONObject.NULL : stableCategory);
    }

    private JSONObject productListEntry(JSONObject record) throws Exception {
        JSONObject data = record.getJSONObject("local").getJSONObject("data");
        // Older product records may have a complete rich body but empty list projections.
        // Derive only the read view here; never rewrite an imported/phone record on listing.
        String searchText = data.optString("searchText", "");
        String excerpt = data.optString("preview", "");
        int words = data.optInt("wordCount", 0);
        if (searchText.isEmpty() || excerpt.isEmpty() || words == 0) {
            JSONObject richBody = data.optJSONObject("body");
            String bodyText = richBody == null ? "" : plain(richBody);
            if (searchText.isEmpty() && !bodyText.isEmpty()) searchText = bodyText;
            if (excerpt.isEmpty() && !bodyText.isEmpty()) excerpt = preview(bodyText);
            if (words == 0 && !bodyText.isEmpty()) words = countWords(bodyText);
        }
        // UI fields are projections only; _product.refs remain in record.local.data.
        return new JSONObject().put("id", record.getString("entityId"))
            .put("title", data.optString("title", ""))
            .put("date", data.optString("date", ""))
            .put("categoryId", data.optJSONObject("_product") != null && data.getJSONObject("_product").optJSONObject("refs") != null &&
                data.getJSONObject("_product").getJSONObject("refs").opt("category") instanceof String
                ? data.getJSONObject("_product").getJSONObject("refs").getString("category") : data.opt("categoryId"))
            .put("category", data.opt("category"))
            .put("tags", data.optJSONArray("tags") == null ? new JSONArray() : data.getJSONArray("tags"))
            .put("revision", data.optInt("revision", 0))
            .put("preview", excerpt)
            .put("searchText", searchText)
            .put("wordCount", words)
            .put("createdAt", data.opt("createdAt"))
            .put("updatedAt", data.opt("updatedAt"))
            .put("contentEditedAt", data.opt("contentEditedAt"))
            .put("contentFormat", data.optString("contentFormat", ""))
            .put("attachments", data.optJSONArray("attachments") == null ? new JSONArray() : data.getJSONArray("attachments"))
            .put("location", data.opt("location"))
            .put("place", data.opt("place"))
            .put("pinned", data.optBoolean("pinned"))
            .put("deleted", data.optBoolean("deleted"))
            .put("productLocalRevision", record.getLong("localRevision"));
    }

    private JSONObject getEntryForDisplay(String entryId) throws Exception {
        JSONObject record = productRepository.inCurrentTransaction(tx -> tx.getEntity("journalAggregate", entryId));
        if (record != null) {
            JSONObject view = productEntryView(record);
            if (view.isNull("entry")) throw new StoreException("not_found", "这篇日记目前不可阅读");
            return view.getJSONObject("entry");
        }
        return getEntry(entryId, false);
    }

    /** Read-only suggestion for an existing hand-written new draft, never an assigned title. */
    private JSONObject getSuggestedTitle(JSONObject request) throws Exception {
        String entryId=id(request,"entryId");
        String date=string(request,"date",10,false);
        try { if(!LocalDate.parse(date).toString().equals(date)) invalid("日期须为YYYY-MM-DD"); }
        catch(java.time.DateTimeException error){invalid("日期须为YYYY-MM-DD");}
        Object rawCategory=request.opt("categoryId");
        if(rawCategory!=null&&rawCategory!=JSONObject.NULL&&!(rawCategory instanceof String))invalid("分类编号无效");
        String categoryId=rawCategory instanceof String?(String)rawCategory:null;
        if(categoryId!=null&&categoryId.isEmpty())categoryId=null;
        if(categoryId!=null&&categoryId.length()>128)invalid("分类编号无效");
        if(exists("entries","id",entryId))throw new StoreException("unsupported","只能给仍未成篇的手写新稿建议标题");
        try(Cursor c=db.rawQuery("SELECT 1 FROM product017_records WHERE entityType='journalAggregate' AND entityId=?",new String[]{entryId})){
            if(c.moveToFirst())throw new StoreException("unsupported","此篇已有产品记录，不能按新稿命名");
        }
        JSONObject draft=entryDraft(entryId);
        if(draft==null||!draft.optBoolean("draftOnly",false)||!entryId.equals(draft.optString("id")))
            throw new StoreException("unsupported","当前不是手写新日记草稿");
        String label=categoryId==null?"未分类":null;
        boolean productCategory=false;
        if(categoryId!=null){
            try(Cursor c=db.rawQuery("SELECT name FROM categories WHERE id=?",new String[]{categoryId})){
                if(c.moveToFirst())label=c.getString(0);
            }
            try(Cursor c=db.rawQuery("SELECT record FROM product017_records WHERE entityType='taxonomy' AND entityId=?",new String[]{categoryId})){
                if(c.moveToFirst()){
                    productCategory=true;
                    JSONObject record=new JSONObject(c.getString(0));
                    JSONObject local=record.optJSONObject("local"),data=local==null?null:local.optJSONObject("data");
                    if(local==null||!"active".equals(local.optString("state"))||data==null||!"category".equals(data.optString("kind")))
                        throw new StoreException("unsupported","分类原件尚不能用于命名");
                    String productName=data.optString("name","");
                    if(label!=null&&!label.equals(productName))throw new StoreException("unsupported","分类身份有冲突");
                    label=productName;
                }
            }
            if(label==null||label.trim().isEmpty())throw new StoreException("unsupported","分类身份尚不能确认");
        }
        int count=0;
        final boolean stableCategoryIdentity=productCategory;
        Set<String> productIds=new HashSet<>();
        // Read only record envelopes; packed bodies remain opaque and are never hydrated.
        try(Cursor c=db.rawQuery("SELECT entityId,record FROM product017_records WHERE entityType='journalAggregate'",null)){
            while(c.moveToNext()){
                String productId=c.getString(0);productIds.add(productId);
                JSONObject record=new JSONObject(c.getString(1));
                JSONObject local=record.optJSONObject("local");
                if(local==null)throw new StoreException("unsupported","日记状态信封缺失，无法可靠计算篇序");
                String state=local.optString("state","");
                if("withdrawn".equals(state)||"deleted".equals(state))continue;
                if(!"active".equals(state))throw new StoreException("unsupported","日记状态无法确认");
                JSONObject data=local.optJSONObject("data");
                if(data==null)throw new StoreException("unsupported","日记原件缺失");
                if(data.optBoolean("deleted")||data.optBoolean("draftOnly"))continue;
                JSONObject product=data.optJSONObject("_product");
                if(product==null||!"entry".equals(product.optString("kind")))
                    throw new StoreException("unsupported","日记来源无法确认");
                JSONObject refs=product.optJSONObject("refs");
                if(product.optBoolean("readOnlyProjection")||data.has("chatJournal")||
                        (refs!=null&&(refs.has("messages")||refs.has("conversation"))))continue;
                String recordDate=data.optString("date","");
                if(recordDate.isEmpty())throw new StoreException("unsupported","日记日期缺失");
                String recordDay=recordDate;
                if(!recordDate.matches("\\d{4}-\\d{2}-\\d{2}")){
                    try{recordDay=java.time.Instant.parse(recordDate).atZone(DIARY_TIME_ZONE).toLocalDate().toString();}
                    catch(java.time.DateTimeException invalidDate){throw new StoreException("unsupported","日记日期不能可靠归类");}
                }
                if(!date.equals(recordDay))continue;
                if(refs==null)throw new StoreException("unsupported","日记分类引用缺失");
                String stableCategory=refs.optString("category","");
                String localCategory=data.optString("categoryId","");
                if(categoryId==null){if(stableCategory.isEmpty()&&localCategory.isEmpty())count++;}
                else if(categoryId.equals(stableCategory)||(!stableCategoryIdentity&&categoryId.equals(localCategory)))count++;
            }
        }
        try(Cursor c=db.rawQuery("SELECT id,categoryId FROM entries WHERE deleted=0 AND date=?",new String[]{date})){
            while(c.moveToNext()){
                String rowId=c.getString(0);
                if(rowId.equals(entryId)||productIds.contains(rowId))continue;
                String rowCategory=c.getString(1);
                if(categoryId==null?rowCategory==null:categoryId.equals(rowCategory))count++;
            }
        }
        int sequence=count+1;
        JSONObject titlePreferences=writingPreferences();
        JSONObject overrides=titlePreferences.optJSONObject("categoryTitleFormats");
        String format=categoryId!=null&&overrides!=null?overrides.optString(categoryId,titlePreferences.optString("titleFormat",DEFAULT_TITLE_FORMAT))
            :titlePreferences.optString("titleFormat",DEFAULT_TITLE_FORMAT);
        String title=renderSuggestedTitle(format,label,date,sequence);
        if(title.length()>500)throw new StoreException("unsupported","分类名称过长，不能安全生成标题");
        return new JSONObject().put("title",title).put("date",date)
            .put("categoryId",categoryId==null?JSONObject.NULL:categoryId).put("sequence",sequence);
    }

    private static final String DEFAULT_TITLE_FORMAT="{category}{sequence}_{date}";
    private static String checkedTitleFormat(String value) throws StoreException {
        if(value==null||value.isEmpty()||value.length()>120||value.matches("(?s).*[\\p{Cntrl}<>].*"))
            throw new StoreException("invalid","标题格式须在120字以内且不能含控制字符或尖括号");
        String literal=value.replace("{category}","").replace("{sequence}","").replace("{number}","").replace("{date}","");
        if(literal.indexOf('{')>=0||literal.indexOf('}')>=0||!value.contains("{category}")||
                !value.contains("{date}")||(!value.contains("{sequence}")&&!value.contains("{number}")))
            throw new StoreException("invalid","标题格式须包含{category}、{date}与{sequence}或{number}");
        return value;
    }

    private static String chineseSequence(int value) {
        if(value<=0)return Integer.toString(value);
        if(value>=100000000){int rest=value%100000000;return chineseSequence(value/100000000)+"亿"+(rest==0?"":(rest<10000000?"零":"")+chineseSequence(rest));}
        if(value>=10000){int rest=value%10000;return chineseSequence(value/10000)+"万"+(rest==0?"":(rest<1000?"零":"")+chineseSequence(rest));}
        String[] digit={"","一","二","三","四","五","六","七","八","九"};
        String[] unit={"","十","百","千"};
        StringBuilder out=new StringBuilder();boolean zero=false;
        for(int place=3;place>=0;place--){
            int n=value/(int)Math.pow(10,place)%10;
            if(n==0){if(out.length()>0)zero=true;continue;}
            if(zero){out.append("零");zero=false;}
            if(!(place==1&&n==1&&out.length()==0))out.append(digit[n]);
            out.append(unit[place]);
        }
        return out.toString();
    }

    private static String renderSuggestedTitle(String format,String category,String date,int sequence) throws StoreException {
        checkedTitleFormat(format);
        java.util.regex.Matcher token=java.util.regex.Pattern.compile("\\{(category|sequence|number|date)\\}").matcher(format);
        StringBuffer result=new StringBuffer();
        while(token.find()){
            String replacement;
            switch(token.group(1)){
                case "category":replacement=category;break;
                case "sequence":replacement=chineseSequence(sequence);break;
                case "number":replacement=Integer.toString(sequence);break;
                default:replacement=date.replace("-","");
            }
            token.appendReplacement(result,java.util.regex.Matcher.quoteReplacement(replacement));
        }
        token.appendTail(result);
        return result.toString();
    }

    private JSONObject saveSuggestedTitleFormats(JSONObject request) throws Exception {
        JSONObject value=writingPreferences();
        long revision=value.getLong("revision");
        if(!(request.opt("baseRevision") instanceof Number)||request.getLong("baseRevision")!=revision||request.getDouble("baseRevision")!=(double)revision)
            throw new StoreException("conflict","写作设置已变化，请重新载入后保存标题格式",value);
        Object raw=request.opt("titleFormat");
        if(!(raw instanceof String))invalid("标题格式无效");
        String format=checkedTitleFormat((String)raw);
        JSONObject requestOverrides=request.optJSONObject("categoryTitleFormats");
        if(requestOverrides==null)invalid("分类标题格式无效");
        JSONObject overrides=new JSONObject();
        for(java.util.Iterator<String> keys=requestOverrides.keys();keys.hasNext();){
            String categoryId=keys.next();
            if(categoryId.isEmpty()||categoryId.length()>128)invalid("分类标题格式对应的分类不存在");
            diaryCategoryName(categoryId);
            Object categoryFormat=requestOverrides.opt(categoryId);
            if(!(categoryFormat instanceof String))invalid("分类标题格式无效");
            overrides.put(categoryId,checkedTitleFormat((String)categoryFormat));
        }
        if(!format.equals(value.optString("titleFormat",DEFAULT_TITLE_FORMAT))||
                !overrides.toString().equals(value.optJSONObject("categoryTitleFormats")==null?"{}":value.getJSONObject("categoryTitleFormats").toString())){
            value.put("titleFormat",format).put("categoryTitleFormats",overrides);putWritingPreferences(value);
        }
        return value;
    }

    private JSONObject writingPreferences() throws Exception {
        JSONObject value;
        try (Cursor c=db.rawQuery("SELECT value FROM meta WHERE key=?",new String[]{WRITING_PREFERENCES_KEY})) {
            value=c.moveToFirst()?new JSONObject(c.getString(0)):new JSONObject().put("version",1).put("defaultCategoryId",JSONObject.NULL);
        }
        // Preserve unknown preference fields. A stale default never blocks quick writing.
        String cat=value.isNull("defaultCategoryId")?null:value.optString("defaultCategoryId",null);
        if(cat==null||cat.isEmpty()||!exists("categories","id",cat))value.put("defaultCategoryId",JSONObject.NULL);
        value.put("revision",Math.max(0,value.optLong("revision",0)));
        String titleFormat=value.optString("titleFormat",DEFAULT_TITLE_FORMAT);
        try{checkedTitleFormat(titleFormat);}catch(StoreException badFormat){titleFormat=DEFAULT_TITLE_FORMAT;}
        value.put("titleFormat",titleFormat);
        if(value.optJSONObject("categoryTitleFormats")==null)value.put("categoryTitleFormats",new JSONObject());
        Set<String> remaining=new LinkedHashSet<>();
        try(Cursor c=db.rawQuery("SELECT id FROM categories ORDER BY rowid",null)){while(c.moveToNext())remaining.add(c.getString(0));}
        JSONArray stored=value.optJSONArray("categoryOrder"),order=new JSONArray();
        if(stored!=null)for(int i=0;i<stored.length();i++)if(stored.opt(i) instanceof String&&remaining.remove(stored.getString(i)))order.put(stored.getString(i));
        for(String categoryId:remaining)order.put(categoryId);value.put("categoryOrder",order);
        return value;
    }

    private void putWritingPreferences(JSONObject value) throws Exception {
        long revision=value.optLong("revision",0);if(revision==Long.MAX_VALUE)throw new StoreException("storage","设置版本已超出支持范围");
        value.put("revision",revision+1);
        ContentValues row=new ContentValues();row.put("key",WRITING_PREFERENCES_KEY);row.put("value",value.toString());
        if(db.insertWithOnConflict("meta",null,row,SQLiteDatabase.CONFLICT_REPLACE)<0)
            throw new StoreException("storage","写作设置未保存");
    }

    private JSONObject saveWritingPreferences(JSONObject request) throws Exception {
        if(!request.has("defaultCategoryId"))invalid("请选择新日记默认分类");
        String cat=null;
        if(!request.isNull("defaultCategoryId")) {
            cat=id(request,"defaultCategoryId");
            if(!exists("categories","id",cat))invalid("分类不存在");
        }
        JSONObject value=writingPreferences();value.put("defaultCategoryId",nullable(cat));putWritingPreferences(value);return value;
    }

    private JSONObject saveCategoryOrder(JSONObject request) throws Exception {
        JSONObject value=writingPreferences();long revision=value.getLong("revision");
        if(!(request.opt("baseRevision") instanceof Number)||request.getLong("baseRevision")!=revision||request.getDouble("baseRevision")!=(double)revision)
            throw new StoreException("conflict","分类或写作设置已更新；请保留草稿并重新载入排序",value);
        JSONArray order=request.optJSONArray("categoryOrder"),current=value.getJSONArray("categoryOrder");
        if(order==null||order.length()!=current.length())invalid("排序须完整包含当前分类");
        Set<String> remaining=new HashSet<>();for(int i=0;i<current.length();i++)remaining.add(current.getString(i));
        for(int i=0;i<order.length();i++)if(!(order.opt(i) instanceof String)||!remaining.remove(order.getString(i)))invalid("排序包含重复或不存在的分类");
        if(!remaining.isEmpty())invalid("排序缺少分类");
        value.put("categoryOrder",new JSONArray(order.toString()));putWritingPreferences(value);return value;
    }

    private String categoryLabel(JSONObject request,String exceptId) throws Exception {
        String name=string(request,"name",BODY_LIMIT,false).replaceAll("^[\\s\\p{Zs}]+|[\\s\\p{Zs}]+$","");
        if(name.isEmpty()||name.length()>80||name.matches("(?s).*\\p{Cntrl}.*"))invalid("分类名称须为1至80个字符，不能包含控制字符");
        try(Cursor c=db.rawQuery("SELECT id,name FROM categories",null)) {
            while(c.moveToNext())if(!c.getString(0).equals(exceptId)&&name.equalsIgnoreCase(c.getString(1)))
                throw new StoreException("duplicate","已有同名分类");
        }
        return name;
    }

    private JSONObject createCategory(JSONObject request) throws Exception {
        String name=categoryLabel(request,null),categoryId=uuid();ContentValues row=new ContentValues();
        row.put("id",categoryId);row.put("name",name);db.insertOrThrow("categories",null,row);
        putWritingPreferences(writingPreferences());
        return new JSONObject().put("id",categoryId).put("name",name);
    }

    private JSONObject renameCategory(JSONObject request) throws Exception {
        String categoryId=id(request,"id");if(!exists("categories","id",categoryId))throw new StoreException("not_found","分类不存在");
        String name=categoryLabel(request,categoryId);ContentValues row=new ContentValues();row.put("name",name);
        db.update("categories",row,"id=?",new String[]{categoryId});putWritingPreferences(writingPreferences());
        return new JSONObject().put("id",categoryId).put("name",name);
    }

    private JSONObject deleteCategory(JSONObject request) throws Exception {
        String categoryId=id(request,"id");if(!exists("categories","id",categoryId))throw new StoreException("not_found","分类不存在");
        JSONObject preferences=writingPreferences();
        // Metadata changes reject a stale editor but preserve the content clock used by time fallback.
        int affectedEntries;
        try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM entries WHERE categoryId=?",new String[]{categoryId})) {c.moveToFirst();affectedEntries=c.getInt(0);}
        db.execSQL("UPDATE entries SET categoryId=NULL,revision=revision+1 WHERE categoryId=?",new Object[]{categoryId});
        ContentValues none=new ContentValues();none.putNull("categoryId");int affectedRooms=db.update("rooms",none,"categoryId=?",new String[]{categoryId});
        boolean resetDefault=categoryId.equals(preferences.optString("defaultCategoryId",null));
        if(resetDefault)preferences.put("defaultCategoryId",JSONObject.NULL);
        db.delete("categories","id=?",new String[]{categoryId});
        JSONArray order=new JSONArray(),prior=preferences.getJSONArray("categoryOrder");
        for(int i=0;i<prior.length();i++)if(!categoryId.equals(prior.getString(i)))order.put(prior.getString(i));
        JSONObject titleOverrides=preferences.optJSONObject("categoryTitleFormats");
        if(titleOverrides!=null)titleOverrides.remove(categoryId);
        preferences.put("categoryOrder",order);putWritingPreferences(preferences);
        return new JSONObject().put("id",categoryId).put("deleted",true).put("affectedEntries",affectedEntries)
                .put("affectedRooms",affectedRooms).put("defaultCategoryReset",resetDefault).put("writingPreferences",preferences);
    }

    private JSONObject getEntry(String entryId, boolean deleted) throws Exception {
        try (Cursor c = db.rawQuery("SELECT * FROM entries WHERE id=?" + (deleted ? "" : " AND deleted=0"), new String[]{entryId})) {
            if (c.moveToFirst()) return entry(c, true);
        }
        JSONObject draft = entryDraft(entryId);
        if (draft != null) return draft;
        throw new StoreException("not_found", "这篇日记不存在");
    }

    private JSONObject entryDraft(String entryId) throws Exception {
        try (Cursor c = db.rawQuery("SELECT value FROM meta WHERE key=?", new String[]{ENTRY_DRAFT_PREFIX + entryId})) {
            if (!c.moveToFirst()) return null;
            JSONObject draft=new JSONObject(c.getString(0));
            if(!draft.has("contentEditedAt"))draft.put("contentEditedAt",draft.opt("updatedAt")==null?JSONObject.NULL:draft.opt("updatedAt"));
            draft.put("contentFormat","richdoc").put("attachments",bodyAttachments(draft.getJSONObject("body")));
            return draft;
        }
    }

    private void putEntryDraft(JSONObject draft) throws Exception {
        ContentValues row = new ContentValues(); row.put("key", ENTRY_DRAFT_PREFIX + draft.getString("id"));
        row.put("value", draft.toString());
        if (db.insertWithOnConflict("meta", null, row, SQLiteDatabase.CONFLICT_REPLACE) < 0)
            throw new StoreException("storage", "草稿未保存，请保留编辑内容重试");
    }

    private JSONObject createEntryDraft(JSONObject r) throws Exception {
        String cat = newEntryCategory(r), stamp = now();
        JSONObject draft = new JSONObject().put("id", uuid()).put("title", "").put("date", LocalDate.now(DIARY_TIME_ZONE).toString())
                .put("categoryId", nullable(cat)).put("category", categoryName(cat)).put("tags", new JSONArray())
                .put("body", richText("")).put("contentFormat", "richdoc").put("revision", 1)
                .put("preview", "").put("searchText", "").put("wordCount", 0)
                .put("createdAt", stamp).put("updatedAt", stamp).put("contentEditedAt",stamp).put("attachments",new JSONArray()).put("deleted", false).put("draftOnly", true);
        putEntryDraft(draft); return draft;
    }

    private JSONObject discardEmptyEntryDraft(JSONObject r) throws Exception {
        String entryId = id(r, "id");
        // Never touch entries or assets, including a draft promoted before this queued close request.
        if (exists("entries", "id", entryId)) return new JSONObject().put("id", entryId).put("discarded", false);
        if (productRepository.inCurrentTransaction(tx->tx.getEntity("journalAggregate",entryId))!=null) {
            db.delete("meta","key=?",new String[]{ENTRY_DRAFT_PREFIX+entryId});
            return new JSONObject().put("id",entryId).put("discarded",false);
        }
        JSONObject draft = entryDraft(entryId);
        if (draft == null) return new JSONObject().put("id", entryId).put("discarded", false);
        if (r.has("baseRevision") && (!(r.get("baseRevision") instanceof Number) || r.getDouble("baseRevision") != draft.getInt("revision")))
            throw new StoreException("conflict", "草稿已更新，请先完成自动保存再关闭", draft);
        if (hasEntryContent(draft.getString("title"), draft.getJSONObject("body")))
            throw new StoreException("conflict", "草稿已有内容，不能丢弃", draft);
        db.delete("meta", "key=?", new String[]{ENTRY_DRAFT_PREFIX + entryId});
        return new JSONObject().put("id", entryId).put("discarded", true);
    }

    private JSONObject entry(Cursor c, boolean full) throws Exception {
        JSONObject body = new JSONObject(value(c,"body"));
        String text = plain(body);
        JSONObject result = new JSONObject().put("id",value(c,"id")).put("title",value(c,"title"))
                .put("date",value(c,"date")).put("categoryId", nullable(value(c,"categoryId")))
                .put("category",categoryName(value(c,"categoryId"))).put("tags",new JSONArray(value(c,"tags")))
                .put("revision",c.getInt(c.getColumnIndexOrThrow("revision"))).put("preview",preview(text)).put("searchText",text)
                .put("wordCount",countWords(text)).put("createdAt",value(c,"createdAt")).put("updatedAt",value(c,"updatedAt"))
                .put("deleted",c.getInt(c.getColumnIndexOrThrow("deleted")) != 0)
                .put("pinned",c.getInt(c.getColumnIndexOrThrow("pinned")) != 0)
                .put("contentEditedAt",nullable(value(c,"contentEditedAt"))).put("contentFormat","richdoc").put("attachments",bodyAttachments(body));
        if (full) result.put("body", body);
        return result;
    }

    private String newEntryCategory(JSONObject r) throws Exception {
        String cat;
        // Quick-write callers historically pass an empty category string. Null explicitly opts out.
        if(!r.has("categoryId")||(!r.isNull("categoryId")&&"".equals(r.optString("categoryId")))) {
            JSONObject preferences=writingPreferences();cat=preferences.isNull("defaultCategoryId")?null:preferences.getString("defaultCategoryId");
        } else cat=category(r);
        return cat;
    }

    private JSONObject createEntry(JSONObject r) throws Exception {
        String entryId=uuid(), now=now(), cat=newEntryCategory(r);
        ContentValues v = new ContentValues(); v.put("id",entryId); v.put("title","");
        v.put("date",LocalDate.now(DIARY_TIME_ZONE).toString()); v.put("categoryId",cat); v.put("tags","[]");
        v.put("body",richText("").toString()); v.put("revision",1); v.put("createdAt",now); v.put("updatedAt",now);
        v.put("contentEditedAt",now);
        db.insertOrThrow("entries",null,v);
        return getEntry(entryId,false);
    }

    /** Existing draft owner only: autosave never publishes an Entry or changes old entries. */
    private JSONObject saveEntryDraft(JSONObject request) throws Exception {
        String entryId=id(request,"id");
        if(exists("entries","id",entryId)||productRepository.inCurrentTransaction(tx->tx.getEntity("journalAggregate",entryId))!=null)
            throw new StoreException("product_authority","此篇已成篇，不能作为新草稿保存");
        JSONObject draft=entryDraft(entryId);
        if(draft==null||!draft.optBoolean("draftOnly"))throw new StoreException("not_found","新草稿不存在");
        JSONObject saved=saveEntry(request,true);
        return new JSONObject().put("entry",saved).put("record",JSONObject.NULL)
            .put("localRevision",0).put("legacy",true).put("readOnly",false)
            .put("sourceId",productChatSourceId()).put("media",productEntryMedia(saved));
    }

    private JSONObject saveEntry(JSONObject r) throws Exception { return saveEntry(r,false); }

    private JSONObject saveEntry(JSONObject r, boolean keepDraft) throws Exception {
        String entryId=id(r,"id");
        JSONObject old=getEntry(entryId,false);
        if (!r.has("baseRevision") || !(r.get("baseRevision") instanceof Number) || r.getDouble("baseRevision")!=old.getInt("revision"))
            throw new StoreException("conflict","日记已在别处修改，请保留当前内容并重新载入",old);
        JSONObject body = r.optJSONObject("body"); validateBody(body);
        if(body.toString().length()>ENTRY_BODY_LIMIT)invalid("富文档超过电脑写入上限，原件未改变");
        if(r.has("contentFormat")&&!"richdoc".equals(r.optString("contentFormat")))throw new StoreException("unsupported","当前写口仅支持richdoc，原件未改变");
        validateEntryAttachments(r,body);
        String date=string(r,"date",10,false);
        try { if (!LocalDate.parse(date).toString().equals(date)) invalid("日期无效"); }
        catch (java.time.DateTimeException e) { invalid("日期须为YYYY-MM-DD"); }
        JSONArray tags=r.optJSONArray("tags"); if(tags==null || tags.length()>50) invalid("标签最多50个");
        Set<String> seen=new HashSet<>(); JSONArray cleanTags=new JSONArray();
        for(int i=0;i<tags.length();i++) {
            if(!(tags.get(i) instanceof String)) invalid("标签须为文字");
            String tag=tags.getString(i); if(tag.length()>=100) invalid("标签长度无效");
            if(seen.add(tag)) cleanTags.put(tag);
        }
        String title=string(r,"title",500,true);
        boolean isDraft=old.optBoolean("draftOnly",false), meaningful=hasEntryContent(title,body);
        // Existing entries, including historical empty rows, are never removed or rewritten empty here.
        if(!isDraft&&!meaningful) throw new StoreException("empty_entry","空白内容不能覆盖已保存日记，请保留原文或明确删除日记",old);
        boolean bodyChanged=!jsonEquivalent(old.getJSONObject("body"),body);
        boolean contentChanged=!title.equals(old.getString("title"))||bodyChanged;
        String cat=keepDraft?(r.isNull("categoryId")||r.optString("categoryId").isEmpty()?null:id(r,"categoryId")):category(r);
        String draftCategory=keepDraft?diaryCategoryName(cat):categoryName(cat);
        String updatedAt=contentChanged?now():old.getString("updatedAt");
        Object contentEditedAt=bodyChanged?updatedAt:old.has("contentEditedAt")?old.get("contentEditedAt"):old.opt("updatedAt");
        if(isDraft&&(!meaningful||keepDraft)) {
            String text=plain(body);
            old.put("title",title).put("date",date).put("categoryId",nullable(cat)).put("category",draftCategory)
                    .put("tags",cleanTags).put("body",body).put("revision",old.getInt("revision")+1)
                    .put("updatedAt",updatedAt).put("contentEditedAt",contentEditedAt==null?JSONObject.NULL:contentEditedAt).put("attachments",bodyAttachments(body)).put("preview",preview(text)).put("searchText",text).put("wordCount",countWords(text));
            if(r.has("location"))old.put("location",string(r,"location",100,true));
            putEntryDraft(old); return old;
        }
        ContentValues v=new ContentValues(); v.put("title",title); v.put("date",date);
        v.put("categoryId",cat); v.put("tags",cleanTags.toString()); v.put("body",body.toString());
        v.put("revision",old.getInt("revision")+1); v.put("updatedAt",updatedAt);
        if(contentEditedAt==null||contentEditedAt==JSONObject.NULL)v.putNull("contentEditedAt");else v.put("contentEditedAt",(String)contentEditedAt);
        if(isDraft) {
            v.put("id",entryId); v.put("createdAt",old.getString("createdAt"));
            db.insertOrThrow("entries",null,v);
            db.delete("meta","key=?",new String[]{ENTRY_DRAFT_PREFIX+entryId});
        } else db.update("entries",v,"id=?",new String[]{entryId});
        return getEntry(entryId,false);
    }

    private JSONObject setEntryPinned(JSONObject r) throws Exception {
        String entryId=id(r,"id"); JSONObject old=getEntry(entryId,true);
        if(old.optBoolean("deleted") || old.optBoolean("draftOnly"))
            throw new StoreException("invalid","只能置顶已保存且未删除的日记");
        if(!(r.opt("baseRevision") instanceof Number) || r.getDouble("baseRevision")!=old.getInt("revision"))
            throw new StoreException("conflict","日记已在别处修改，请重新载入",old);
        if(!(r.opt("pinned") instanceof Boolean)) invalid("置顶状态须为布尔值");
        if(old.getInt("revision")==Integer.MAX_VALUE) throw new StoreException("storage","日记版本已超出支持范围");
        ContentValues v=new ContentValues(); v.put("pinned",r.getBoolean("pinned")?1:0);
        v.put("revision",old.getInt("revision")+1); v.put("updatedAt",now());
        db.update("entries",v,"id=?",new String[]{entryId});
        return getEntry(entryId,true);
    }

    private JSONObject deleteEntry(JSONObject r) throws Exception {
        String entryId=id(r,"id"); JSONObject old=getEntry(entryId,true);
        if(!old.getBoolean("deleted")) {
            ContentValues v=new ContentValues(); v.put("deleted",1); v.put("revision",old.getInt("revision")+1); v.put("updatedAt",now());
            db.update("entries",v,"id=?",new String[]{entryId});
        }
        return new JSONObject().put("id",entryId).put("deleted",true);
    }

    private JSONObject createRoom(JSONObject r) throws Exception {
        String roomId=uuid(), time=now(); ContentValues v=new ContentValues();
        v.put("id",roomId); v.put("name",string(r,"name",80,false).trim()); v.put("categoryId",category(r));
        v.put("createdAt",time); v.put("updatedAt",time); db.insertOrThrow("rooms",null,v);
        return getRoom(roomId);
    }

    private JSONObject getRoom(String roomId) throws Exception {
        try(Cursor c=db.rawQuery("SELECT * FROM rooms WHERE id=?",new String[]{roomId})) {
            if(!c.moveToFirst()) throw new StoreException("not_found","会话不存在");
            return room(c);
        }
    }

    private JSONObject room(Cursor c) throws Exception {
        String roomId=value(c,"id"), text=""; int count=0;
        try(Cursor last=db.rawQuery("SELECT body,state FROM messages WHERE roomId=? ORDER BY eventTime DESC,id DESC LIMIT 1",new String[]{roomId})) {
            if(last.moveToFirst()) text="withdrawn".equals(value(last,"state"))?"消息已撤回":plain(new JSONObject(value(last,"body")));
        }
        try(Cursor n=db.rawQuery("SELECT COUNT(*) FROM messages WHERE roomId=?",new String[]{roomId})) { n.moveToFirst(); count=n.getInt(0); }
        return new JSONObject().put("id",roomId).put("name",value(c,"name")).put("categoryId",nullable(value(c,"categoryId")))
                .put("category",categoryName(value(c,"categoryId"))).put("draft",value(c,"draft"))
                .put("draftReplyTo",nullable(value(c,"draftReplyTo"))).put("preview",preview(text)).put("count",count)
                .put("createdAt",value(c,"createdAt")).put("updatedAt",value(c,"updatedAt"));
    }

    private JSONObject renameRoom(JSONObject r) throws Exception {
        String roomId=id(r,"id"); getRoom(roomId); ContentValues v=new ContentValues();
        v.put("name",string(r,"name",80,false).trim()); v.put("updatedAt",now());
        db.update("rooms",v,"id=?",new String[]{roomId}); return getRoom(roomId);
    }

    private JSONObject getMessages(JSONObject r) throws Exception {
        String roomId=id(r,"roomId"); getRoom(roomId);
        int limit=60;
        if(r.has("limit")) {
            if(!(r.get("limit") instanceof Number) || r.getDouble("limit")!=r.getInt("limit")) invalid("分页数量无效");
            limit=r.getInt("limit"); if(limit<1 || limit>200) invalid("分页数量须为1至200");
        }
        String where="roomId=?"; String[] args={roomId};
        if(r.has("before") && !r.isNull("before")) {
            String beforeId;
            Object before=r.get("before");
            if(before instanceof JSONObject) beforeId=id((JSONObject)before,"id");
            else if(before instanceof String) beforeId=(String)before;
            else { invalid("分页游标无效"); return null; }
            JSONObject m=getMessage(beforeId); if(!roomId.equals(m.getString("roomId"))) invalid("分页游标不属于本会话");
            String instant=m.getString("sentAt"); where+=" AND (eventTime<? OR (eventTime=? AND id<?))";
            args=new String[]{roomId,instant,instant,beforeId};
        }
        JSONArray result=new JSONArray(); java.util.ArrayList<JSONObject> rows=new java.util.ArrayList<>();
        try(Cursor c=db.rawQuery("SELECT * FROM messages WHERE "+where+" ORDER BY eventTime DESC,id DESC LIMIT "+(limit+1),args)) {
            while(c.moveToNext()) rows.add(message(c));
        }
        boolean hasMore=rows.size()>limit; if(hasMore) rows.remove(rows.size()-1);
        for(int i=rows.size()-1;i>=0;i--) result.put(rows.get(i));
        return new JSONObject().put("messages",result).put("hasMore",hasMore)
                .put("nextBefore",result.length()==0?JSONObject.NULL:result.getJSONObject(0).getString("id"));
    }

    private JSONObject saveDraft(JSONObject r) throws Exception {
        String roomId=id(r,"roomId"); getRoom(roomId); String reply=reply(r,roomId);
        ContentValues v=new ContentValues(); v.put("draft",string(r,"text",100000,true)); v.put("draftReplyTo",reply);
        db.update("rooms",v,"id=?",new String[]{roomId}); return getRoom(roomId);
    }

    private JSONObject sendMessage(JSONObject r) throws Exception {
        String roomId=id(r,"roomId"), clientId=id(r,"clientId"); getRoom(roomId);
        try(Cursor existing=db.rawQuery("SELECT * FROM messages WHERE roomId=? AND clientId=?",new String[]{roomId,clientId})) {
            if(existing.moveToFirst()) return message(existing);
        }
        String reply=reply(r,roomId); String asset=r.has("assetId")&&!r.isNull("assetId")?id(r,"assetId"):null;
        JSONObject body;
        if(r.has("body")) { body=r.optJSONObject("body"); validateBody(body); }
        else {
            String text=r.has("text")?string(r,"text",100000,true):"";
            body=richText(text);
            if(asset!=null) {
                JSONObject a=getAsset(asset); String type=a.getString("mime").startsWith("video/")?"video":"image";
                body.getJSONArray("content").put(new JSONObject().put("type",type).put("attrs",new JSONObject()
                        .put("blockId",uuid()).put("assetId",asset).put("occurrenceId",uuid()).put("insertedAt",now())
                        .put("widthRatio",1).put("align","center").put("caption","").put("alt",a.getString("name"))));
            }
            validateBody(body);
        }
        if(plain(body).trim().isEmpty() && !hasMedia(body.getJSONArray("content"))) invalid("写一点内容再发送");
        if(asset!=null) getAsset(asset);
        String messageId=uuid(), time=now();
        ContentValues v=new ContentValues(); v.put("id",messageId); v.put("roomId",roomId); v.put("clientId",clientId);
        v.put("body",body.toString()); v.put("eventTime",time); v.put("revision",1); v.put("state","active");
        v.put("replyTo",reply); v.put("assetId",asset); db.insertOrThrow("messages",null,v);
        ContentValues rv=new ContentValues(); rv.put("draft",""); rv.putNull("draftReplyTo"); rv.put("updatedAt",time);
        db.update("rooms",rv,"id=?",new String[]{roomId}); return getMessage(messageId);
    }

    private JSONObject getMessage(String messageId) throws Exception {
        try(Cursor c=db.rawQuery("SELECT * FROM messages WHERE id=?",new String[]{messageId})) {
            if(!c.moveToFirst()) throw new StoreException("not_found","消息不存在"); return message(c);
        }
    }

    private JSONObject message(Cursor c) throws Exception {
        String stored=value(c,"body"), time=value(c,"eventTime");
        JSONObject body=stored==null?null:new JSONObject(stored);
        return new JSONObject().put("id",value(c,"id")).put("roomId",value(c,"roomId")).put("clientId",value(c,"clientId"))
                .put("body",nullable(body)).put("text",body==null?"":plain(body)).put("sentAt",time)
                .put("eventTime",new JSONObject().put("instant",time).put("timeZone","UTC")
                        .put("precision","millisecond").put("source","explicit").put("sourceField","sentAt"))
                .put("revision",c.getInt(c.getColumnIndexOrThrow("revision"))).put("state",value(c,"state"))
                .put("replyTo",nullable(value(c,"replyTo"))).put("assetId",nullable(value(c,"assetId")));
    }

    private JSONObject withdrawMessage(JSONObject r) throws Exception {
        String messageId=id(r,"id"); JSONObject old=getMessage(messageId);
        if(!"withdrawn".equals(old.getString("state"))) {
            ContentValues v=new ContentValues(); v.putNull("body"); v.putNull("assetId");
            v.put("state","withdrawn"); v.put("revision",old.getInt("revision")+1);
            db.update("messages",v,"id=?",new String[]{messageId});
            ContentValues room=new ContentValues(); room.put("updatedAt",now());
            db.update("rooms",room,"id=?",new String[]{old.getString("roomId")});
        }
        return getMessage(messageId);
    }

    private JSONObject exportSnapshot() throws Exception {
        JSONObject result=bootstrap(); JSONArray entries=new JSONArray(), messages=new JSONArray(), assets=new JSONArray();
        try(Cursor c=db.rawQuery("SELECT * FROM entries ORDER BY createdAt,id",null)) { while(c.moveToNext()) entries.put(entry(c,true)); }
        try(Cursor c=db.rawQuery("SELECT * FROM messages ORDER BY eventTime,id",null)) { while(c.moveToNext()) messages.put(message(c)); }
        try(Cursor c=db.rawQuery("SELECT * FROM assets ORDER BY importedAt,id",null)) { while(c.moveToNext()) assets.put(asset(c)); }
        JSONObject product = productRepository.inCurrentTransaction(tx -> new JSONObject()
            .put("records", tx.listEntities()).put("pending", tx.listPending(null))
            .put("conflicts", tx.listConflicts()).put("metadata", tx.getMeta()));
        JSONArray mappings = new JSONArray();
        try(Cursor c=db.rawQuery("SELECT kind,localId,value FROM product017_mappings ORDER BY kind,localId",null)) {
            while(c.moveToNext()) mappings.put(new JSONObject().put("kind",c.getString(0))
                .put("localId",c.getString(1)).put("value",new JSONObject(c.getString(2))));
        }
        product.put("mappings",mappings);
        return result.put("version",1).put("format","shiye-android-local-snapshot").put("exportedAt",now())
                .put("entries",entries).put("messages",messages).put("assets",assets)
                .put("productRepository",product).put("productRestoreSupported",false);
    }

    public synchronized File mediaFile(String assetId) throws Exception {
        if(assetId==null || !assetId.matches("[A-Za-z0-9_-]{1,100}")) invalid("媒体编号无效");
        getAsset(assetId); File f=new File(mediaDir,assetId);
        if(!f.isFile()) throw new StoreException("not_found","媒体文件缺失");
        return f;
    }

    /** Persist bytes before publishing metadata. Failure never exposes an incomplete asset. */
    public synchronized JSONObject importMedia(InputStream input, String mime, String displayName) throws Exception {
        if(input==null || mime==null || !Arrays.asList("image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm").contains(mime))
            invalid("请选择JPEG、PNG、WebP、GIF、MP4或WebM文件");
        if(displayName==null || displayName.trim().isEmpty()) displayName="图片";
        if(displayName.length()>300 || displayName.indexOf('\0')>=0) invalid("文件名过长或无效");
        String assetId=uuid(); File temp=new File(mediaDir,assetId+".part"), target=new File(mediaDir,assetId);
        boolean committed=false;
        try {
            MessageDigest digest=MessageDigest.getInstance("SHA-256"); long size=0;
            byte[] header=new byte[32]; int headerSize=0;
            try(FileOutputStream out=new FileOutputStream(temp)) {
                byte[] buffer=new byte[32768]; int n;
                while((n=input.read(buffer))!=-1) {
                    if(n==0) continue; size+=n; if(size>MEDIA_LIMIT) invalid("单个媒体文件不能超过20MB");
                    int copy=Math.min(n,header.length-headerSize); if(copy>0) { System.arraycopy(buffer,0,header,headerSize,copy); headerSize+=copy; }
                    digest.update(buffer,0,n); out.write(buffer,0,n);
                }
                out.getFD().sync();
            }
            if(size==0 || !matchesSignature(header,headerSize,mime)) invalid("文件内容与媒体类型不一致");
            if(!temp.renameTo(target)) throw new Exception("媒体文件保存失败");
            StringBuilder sha=new StringBuilder(); for(byte b:digest.digest()) sha.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
            ContentValues v=new ContentValues(); v.put("id",assetId); v.put("name",displayName); v.put("mime",mime);
            v.put("size",size); v.put("sha256",sha.toString()); v.put("importedAt",now());
            db.beginTransaction();
            try { db.insertOrThrow("assets",null,v); db.setTransactionSuccessful(); }
            finally { db.endTransaction(); }
            committed=true; return getAsset(assetId);
        } finally {
            if(temp.exists() && !temp.delete()) temp.deleteOnExit();
            if(!committed && target.exists() && !target.delete()) target.deleteOnExit();
        }
    }

    private static boolean matchesSignature(byte[] b,int n,String mime) {
        if(n<4) return false;
        switch(mime) {
            case "image/jpeg": return (b[0]&255)==255 && (b[1]&255)==216 && (b[2]&255)==255;
            case "image/png": return n>=8 && (b[0]&255)==137 && b[1]==80 && b[2]==78 && b[3]==71 && b[4]==13 && b[5]==10 && b[6]==26 && b[7]==10;
            case "image/gif": return n>=6 && b[0]==71 && b[1]==73 && b[2]==70 && b[3]==56 && (b[4]==55 || b[4]==57) && b[5]==97;
            case "image/webp": return n>=12 && b[0]==82 && b[1]==73 && b[2]==70 && b[3]==70 && b[8]==87 && b[9]==69 && b[10]==66 && b[11]==80;
            case "video/mp4": return n>=12 && b[4]==102 && b[5]==116 && b[6]==121 && b[7]==112;
            case "video/webm": return (b[0]&255)==26 && (b[1]&255)==69 && (b[2]&255)==223 && (b[3]&255)==163;
            default: return false;
        }
    }

    private JSONObject getAsset(String assetId) throws Exception {
        try(Cursor c=db.rawQuery("SELECT * FROM assets WHERE id=?",new String[]{assetId})) {
            if(!c.moveToFirst()) throw new StoreException("not_found","媒体不存在"); return asset(c);
        }
    }
    private JSONObject asset(Cursor c) throws Exception {
        String mime=value(c,"mime");
        return new JSONObject().put("id",value(c,"id")).put("name",value(c,"name")).put("mime",mime).put("type",mime)
                .put("size",c.getLong(c.getColumnIndexOrThrow("size"))).put("sha256",value(c,"sha256")).put("importedAt",value(c,"importedAt"));
    }

    private String category(JSONObject r) throws Exception {
        if(!r.has("categoryId") || r.isNull("categoryId") || "".equals(r.optString("categoryId"))) return null;
        String cat=id(r,"categoryId"); if(!exists("categories","id",cat)) invalid("分类不存在"); return cat;
    }
    private String diaryCategoryName(String cat) throws Exception {
        if(cat==null)return "未分类";
        JSONObject record=productRepository.inCurrentTransaction(tx->tx.getEntity("taxonomy",cat));
        if(record!=null){
            JSONObject local=record.optJSONObject("local"),data=local==null?null:local.optJSONObject("data");
            if(local==null||!"active".equals(local.optString("state"))||data==null||!"category".equals(data.optString("kind")))
                throw new StoreException("invalid","分类不存在或已不可用");
            return data.getString("name");
        }
        if(!exists("categories","id",cat))throw new StoreException("invalid","分类不存在");
        return categoryName(cat);
    }
    private String categoryName(String cat) {
        if(cat==null) return "未分类";
        try(Cursor c=db.rawQuery("SELECT name FROM categories WHERE id=?",new String[]{cat})) { return c.moveToFirst()?c.getString(0):"未分类"; }
    }
    private String reply(JSONObject r,String roomId) throws Exception {
        if(!r.has("replyTo") || r.isNull("replyTo") || "".equals(r.optString("replyTo"))) return null;
        String reply=id(r,"replyTo"); if(!roomId.equals(getMessage(reply).getString("roomId"))) invalid("回复目标不属于本会话"); return reply;
    }
    private boolean exists(String table,String column,String id) {
        try(Cursor c=db.rawQuery("SELECT 1 FROM "+table+" WHERE "+column+"=? LIMIT 1",new String[]{id})) { return c.moveToFirst(); }
    }
    private static String value(Cursor c,String name) { int i=c.getColumnIndexOrThrow(name); return c.isNull(i)?null:c.getString(i); }
    /** Existing inline references only; this DTO is not independent attachment storage. */
    private static JSONArray bodyAttachments(JSONObject body) throws Exception {
        LinkedHashSet<String> ids=new LinkedHashSet<>();collectBodyAttachments(body.optJSONArray("content"),ids);
        JSONArray result=new JSONArray();for(String asset:ids)result.put(asset);return result;
    }
    private static void collectBodyAttachments(JSONArray nodes,Set<String> ids) throws Exception {
        if(nodes==null)return;
        for(int i=0;i<nodes.length();i++){
            JSONObject node=nodes.optJSONObject(i);if(node==null)continue;
            String type=node.optString("type");JSONObject attrs=node.optJSONObject("attrs");
            if((type.equals("image")||type.equals("video"))&&attrs!=null&&attrs.opt("assetId") instanceof String)ids.add(attrs.getString("assetId"));
            collectBodyAttachments(node.optJSONArray("content"),ids);
        }
    }
    private static void validateEntryAttachments(JSONObject request,JSONObject body) throws Exception {
        if(!request.has("attachments"))return;
        JSONArray supplied=request.optJSONArray("attachments");Set<String> actual=new HashSet<>(),incoming=new HashSet<>();
        JSONArray refs=bodyAttachments(body);for(int i=0;i<refs.length();i++)actual.add(refs.getString(i));
        if(supplied!=null)for(int i=0;i<supplied.length();i++){
            if(!(supplied.opt(i) instanceof String))throw new StoreException("unsupported","附件清单不受支持，原件未改变");
            incoming.add(supplied.getString(i));
        }
        if(supplied==null||!incoming.equals(actual))throw new StoreException("unsupported","当前仅支持正文中的媒体引用，独立附件须保留原件，未覆盖日记");
    }
    /** JSON object key order is presentation; array order and exact string whitespace are content. */
    private static boolean jsonEquivalent(Object a,Object b) throws Exception {
        if(a==b)return true;
        if(a==null||b==null||a==JSONObject.NULL||b==JSONObject.NULL)return false;
        if(a instanceof JSONObject&&b instanceof JSONObject){
            JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;
            Iterator<String> keys=x.keys();while(keys.hasNext()){String key=keys.next();if(!y.has(key)||!jsonEquivalent(x.get(key),y.get(key)))return false;}return true;
        }
        if(a instanceof JSONArray&&b instanceof JSONArray){
            JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;
            for(int i=0;i<x.length();i++)if(!jsonEquivalent(x.get(i),y.get(i)))return false;return true;
        }
        if(a instanceof Number&&b instanceof Number)return new java.math.BigDecimal(a.toString()).compareTo(new java.math.BigDecimal(b.toString()))==0;
        return a.equals(b);
    }
    private static Object nullable(Object value) { return value==null?JSONObject.NULL:value; }
    private static String uuid() { return UUID.randomUUID().toString(); }
    private static String now() { return UTC_TIME.format(Instant.now()); }
    private static void invalid(String message) throws StoreException { throw new StoreException("invalid",message); }
    private static String id(JSONObject r,String key) throws Exception {
        String v=string(r,key,200,false); if(!v.matches("[A-Za-z0-9_:-]+")) invalid("编号无效"); return v;
    }
    private static String string(JSONObject r,String key,int max,boolean empty) throws Exception {
        Object raw=r.opt(key); if(!(raw instanceof String)) invalid("缺少或无效的"+key);
        String v=(String)raw; if(v.length()>max || (!empty && v.trim().isEmpty()) || v.indexOf('\0')>=0) invalid(key+"长度或内容无效");
        return v;
    }
    private static String preview(String text) { String s=text.replaceAll("\\s+"," ").trim(); return s.length()>100?s.substring(0,100)+"…":s; }
    private static int countWords(String s) { int n=0; for(int i=0;i<s.length();) { int cp=s.codePointAt(i); if(!Character.isWhitespace(cp)) n++; i+=Character.charCount(cp); } return n; }

    private static JSONObject richText(String text) throws Exception {
        JSONArray blocks=new JSONArray();
        for(String line:text.split("\\n",-1)) blocks.put(paragraph(line));
        return new JSONObject().put("format","shiye-richdoc").put("version",1).put("content",blocks);
    }
    private static JSONObject paragraph(String text) throws Exception {
        JSONObject p=new JSONObject().put("type","paragraph").put("attrs",new JSONObject().put("blockId",uuid()));
        if(!text.isEmpty()) p.put("content",new JSONArray().put(new JSONObject().put("type","text").put("text",text)));
        return p;
    }
    private static String plain(JSONObject body) throws Exception { StringBuilder result=new StringBuilder(); plainNodes(body.getJSONArray("content"),result); return result.toString().trim(); }
    private static void plainNodes(JSONArray nodes,StringBuilder out) throws Exception {
        for(int i=0;i<nodes.length();i++) {
            JSONObject n=nodes.getJSONObject(i); String type=n.getString("type");
            if(type.equals("text")) out.append(n.getString("text"));
            else if(type.equals("image") || type.equals("video")) { out.append(type.equals("image")?"［图片］":"［视频］"); }
            else if(type.equals("hardBreak")) out.append('\n');
            if(n.has("content")) plainNodes(n.getJSONArray("content"),out);
            if(Arrays.asList("paragraph","heading","blockquote","listItem","taskItem","codeBlock","tableRow").contains(type)) out.append('\n');
        }
    }
    private static boolean hasMedia(JSONArray nodes) throws Exception {
        for(int i=0;i<nodes.length();i++) { JSONObject n=nodes.getJSONObject(i); if(Arrays.asList("image","video").contains(n.getString("type")) || (n.has("content") && hasMedia(n.getJSONArray("content")))) return true; }
        return false;
    }

    /** Matches public/shared/quick-capture.js hasQuickContent for canonical richdoc v1. */
    private static boolean hasEntryContent(String title, JSONObject body) throws Exception {
        return hasJsTrimmedText(title) || hasMeaningfulNodes(body.getJSONArray("content"));
    }
    private static boolean hasMeaningfulNodes(JSONArray nodes) throws Exception {
        for(int i=0;i<nodes.length();i++) {
            JSONObject node=nodes.getJSONObject(i); String type=node.getString("type");
            if(type.equals("image")||type.equals("video")) return true;
            if(type.equals("text")&&hasJsTrimmedText(node.getString("text").replace("\u200b","").replace("\ufeff",""))) return true;
            if(node.has("content")&&hasMeaningfulNodes(node.getJSONArray("content"))) return true;
        }
        return false;
    }
    // ECMAScript trim WhiteSpace + LineTerminator; Java String.trim misses full-width/NBSP.
    private static boolean hasJsTrimmedText(String text) {
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(!(c=='\u0009'||c=='\n'||c=='\u000b'||c=='\f'||c=='\r'||c==' '||c=='\u00a0'||c=='\u1680'
                    ||(c>='\u2000'&&c<='\u200a')||c=='\u2028'||c=='\u2029'||c=='\u202f'||c=='\u205f'||c=='\u3000'||c=='\ufeff')) return true;
        }
        return false;
    }

    private void validateBody(JSONObject body) throws Exception {
        if(body==null || body.toString().length()>BODY_LIMIT || !"shiye-richdoc".equals(body.optString("format")) || !(body.opt("version") instanceof Number) || body.getDouble("version")!=1 || !(body.opt("content") instanceof JSONArray)) invalid("富文档格式或版本无效");
        keys(body,"format","version","content");
        Set<String> blocks=new HashSet<>(), occurrences=new HashSet<>(); int[] count={0};
        validateNodes(body.getJSONArray("content"),"doc",0,blocks,occurrences,count);
    }

    private void validateNodes(JSONArray list,String parent,int depth,Set<String> blocks,Set<String> occurrences,int[] count) throws Exception {
        if(depth>64&&list.length()>0) invalid("文档嵌套过深");
        for(int i=0;i<list.length();i++) {
            if(++count[0]>50000 || !(list.opt(i) instanceof JSONObject)) invalid("内容块过多或结构无效");
            JSONObject n=list.getJSONObject(i); keys(n,"type","attrs","content","text","marks"); String type=string(n,"type",40,false);
            String allowed;
            switch(parent) {
                case "paragraph": case "heading": allowed="text hardBreak"; break;
                case "codeBlock": allowed="text"; break;
                case "bulletList": case "orderedList": allowed="listItem"; break;
                case "taskList": allowed="taskItem"; break;
                case "table": allowed="tableRow"; break;
                case "tableRow": allowed="tableCell tableHeader"; break;
                default: allowed="paragraph heading blockquote bulletList orderedList taskList codeBlock horizontalRule table image video";
            }
            if(!Arrays.asList(allowed.split(" ")).contains(type)) invalid("不支持的内容块或层级："+type);
            JSONObject attrs=n.optJSONObject("attrs");
            if(type.equals("text")) {
                if(n.has("attrs") || n.has("content")) invalid("文字块结构无效");
                string(n,"text",BODY_LIMIT,true);
                if(n.getString("text").isEmpty()) invalid("文字块不能为空");
            } else {
                if(n.has("text") || attrs==null) invalid("内容块属性无效");
                String block=id(attrs,"blockId"); if(!blocks.add(block)) invalid("内容块ID重复");
                switch(type) {
                    case "heading": keys(attrs,"blockId","level"); integer(attrs,"level",1,6,true); break;
                    case "orderedList": keys(attrs,"blockId","start","type"); integer(attrs,"start",-1000000000,1000000000,false);
                        if(attrs.has("type")&&!attrs.isNull("type")&&!Arrays.asList("1","a","A","i","I").contains(attrs.optString("type"))) invalid("列表样式无效"); break;
                    case "taskItem": keys(attrs,"blockId","checked"); if(!(attrs.opt("checked") instanceof Boolean)) invalid("任务状态无效"); break;
                    case "codeBlock": keys(attrs,"blockId","language"); if(attrs.has("language")&&!attrs.isNull("language")) string(attrs,"language",100,true); break;
                    case "tableCell": case "tableHeader":
                        keys(attrs,"blockId","colspan","rowspan","colwidth"); integer(attrs,"colspan",1,1000,false); integer(attrs,"rowspan",1,1000,false);
                        if(attrs.has("colwidth")&&!attrs.isNull("colwidth")) {
                            JSONArray widths=attrs.optJSONArray("colwidth"); if(widths==null || widths.length()!=attrs.optInt("colspan",1)) invalid("表格列宽无效");
                            for(int w=0;w<widths.length();w++) if(!(widths.get(w) instanceof Number) || widths.getDouble(w)!=widths.getInt(w) || widths.getInt(w)<1 || widths.getInt(w)>100000) invalid("表格列宽无效");
                        } break;
                    case "image": case "video":
                        keys(attrs,"blockId","assetId","occurrenceId","insertedAt","widthRatio","align","caption","alt");
                        String occurrence=id(attrs,"occurrenceId"); if(!occurrences.add(occurrence)) invalid("媒体出现ID重复");
                        JSONObject asset=getAsset(id(attrs,"assetId"));
                        if(!asset.getString("mime").startsWith(type.equals("image")?"image/":"video/")) invalid("媒体节点类型不匹配");
                        if(!(attrs.opt("widthRatio") instanceof Number) || attrs.getDouble("widthRatio")<0.1 || attrs.getDouble("widthRatio")>1) invalid("媒体宽度无效");
                        if(!Arrays.asList("left","center","right").contains(attrs.optString("align"))) invalid("媒体对齐无效");
                        string(attrs,"caption",10000,true); string(attrs,"alt",10000,true);
                        if(!attrs.has("insertedAt")) invalid("缺少媒体时间");
                        if(!attrs.isNull("insertedAt")) { String time=string(attrs,"insertedAt",60,false); try { if(!time.endsWith("Z")) invalid("媒体时间须为UTC"); Instant.parse(time); } catch(java.time.DateTimeException e) { invalid("媒体时间无效"); } }
                        break;
                    default: keys(attrs,"blockId");
                }
            }
            if(n.has("marks")) {
                JSONArray marks=n.optJSONArray("marks"); if(marks==null || (!type.equals("text")&&!type.equals("hardBreak")) || (parent.equals("codeBlock")&&marks.length()>0)) invalid("格式列表无效");
                Set<String> seen=new HashSet<>();
                for(int m=0;m<marks.length();m++) {
                    JSONObject mark=marks.optJSONObject(m); if(mark==null) invalid("格式无效"); keys(mark,"type","attrs");
                    String mt=string(mark,"type",30,false);
                    if(!seen.add(mt)||!Arrays.asList("bold","italic","highlight","strike","code","underline","link").contains(mt)) invalid("格式不受支持或重复");
                    JSONObject ma=mark.optJSONObject("attrs"); if(mark.has("attrs")&&ma==null) invalid("格式属性无效");
                    if(mt.equals("link")) {
                        if(ma==null) invalid("链接无效"); keys(ma,"href","target","rel","title"); String href=string(ma,"href",10000,false);
                        if(!href.matches("(?i)^(https?://|mailto:)[^\\s\\p{Cntrl}]+$")) invalid("链接不安全");
                        for(String key:Arrays.asList("target","rel","title")) if(ma.has(key)&&!ma.isNull(key)) string(ma,key,10000,true);
                        if(ma.has("target")&&!ma.isNull("target")&&!Arrays.asList("_blank","_self","_parent","_top").contains(ma.getString("target"))) invalid("链接目标无效");
                    } else if(ma!=null) keys(ma);
                }
            }
            if(n.has("content")) {
                JSONArray children=n.optJSONArray("content"); if(children==null || Arrays.asList("text","image","video","hardBreak","horizontalRule").contains(type)) invalid("叶节点不能包含子内容");
                validateNodes(children,type,depth+1,blocks,occurrences,count);
            }
            if(Arrays.asList("bulletList","orderedList","taskList","listItem","taskItem","blockquote","table","tableRow","tableCell","tableHeader").contains(type) && (!n.has("content")||n.getJSONArray("content").length()==0)) invalid("容器内容不能为空");
            if(Arrays.asList("listItem","taskItem").contains(type) && !n.getJSONArray("content").getJSONObject(0).optString("type").equals("paragraph")) invalid("列表项须以段落开始");
        }
    }
    private static void keys(JSONObject object,String... allowed) throws Exception {
        Set<String> set=new HashSet<>(Arrays.asList(allowed)); Iterator<String> keys=object.keys();
        while(keys.hasNext()) if(!set.contains(keys.next())) invalid("包含未知字段，未覆盖原件");
    }
    private static void integer(JSONObject object,String key,int min,int max,boolean required) throws Exception {
        if(!required&&!object.has(key)) return;
        Object v=object.opt(key); if(!(v instanceof Number)||object.getDouble(key)!=object.getInt(key)||object.getInt(key)<min||object.getInt(key)>max) invalid("整数属性无效："+key);
    }

    private void seed() throws Exception {
        String[] categoryNames={"生活","读书","灵感"}; String[] categories=new String[3];
        for(int i=0;i<3;i++) { categories[i]=uuid(); ContentValues c=new ContentValues(); c.put("id",categories[i]);c.put("name",categoryNames[i]);db.insertOrThrow("categories",null,c); }
        String[] titles={"把日子过得慢一点","书页之间的停顿","留给明天的小事"};
        String[] texts={
            "傍晚的风\n今天回家的时候，天还没有完全暗下来。路边的梧桐落了几片叶子，风从树梢穿过去，带着一点干燥又清凉的气味。我没有急着戴上耳机，只是沿着熟悉的路慢慢走，听车轮经过路面的声音，也听自己的脚步。\n楼下的小店亮着暖黄色的灯，有人在挑水果，有人拎着刚买好的晚饭。那些平常不曾留意的画面，忽然变得很具体。原来一天里值得留下的东西，不一定是发生了什么大事，也可以只是一个愿意停下来看的瞬间。\n给自己一点空白\n回到房间，先倒了一杯温水，把窗打开。桌上还摊着早上没读完的书，我翻到折角的那一页，没有要求自己今天一定读完多少。慢慢做完一件小事，比一边着急一边想着许多事，心里更踏实。\n我想把这样的片刻记下来：杯沿的热气，窗外渐渐安静的街道，还有这一刻不用证明什么的轻松。明天依然会有要完成的事情，但今晚可以先好好吃饭，好好休息。生活不必每一页都写得很满，留白也是认真生活的一部分。",
            "读到一句很喜欢的话，先没有急着往下翻。\n有时候，阅读带来的变化很轻：只是下一次走路时多看了一眼天空，或者在忙乱中记起可以慢一点。\n想把这句话留在这里，等过些日子再回来看看，那时会不会有新的理解。",
            "明天想做的三件小事：\n去楼下走一走，不带耳机。\n把书桌右边的一小块地方收拾干净。\n给自己留半小时，只读书，不赶进度。\n先从很小的事情开始，也是一种向前。"
        };
        for(int i=0;i<3;i++) {
            JSONObject e=createEntry(new JSONObject().put("categoryId",categories[i])); JSONObject body=richText(texts[i]);
            if(i==0) {
                JSONArray blocks=body.getJSONArray("content");
                for(int index:new int[]{0,3}) { JSONObject b=blocks.getJSONObject(index); b.put("type","heading"); b.getJSONObject("attrs").put("level",2); }
                blocks.getJSONObject(5).getJSONArray("content").getJSONObject(0).put("marks",new JSONArray().put(new JSONObject().put("type","bold")));
            }
            JSONObject request=new JSONObject().put("id",e.getString("id")).put("baseRevision",1).put("title",titles[i])
                    .put("date",LocalDate.now(DIARY_TIME_ZONE).minusDays(i).toString()).put("categoryId",categories[i]).put("tags",new JSONArray().put(i==0?"慢生活":i==1?"阅读":"小计划")).put("body",body);
            saveEntry(request);
        }
        String[] roomNames={"日常随想","读书摘记","灵感收集"};
        String[][] messages={
            {"窗边的光刚刚好，先坐一会儿。","有些日子没什么特别的事，但也值得记下来。","今天听到的那首歌，想在散步时再听一遍。","晚饭后去走了十分钟。风很舒服，心也安静了一点。","把这一刻留下来，已经很好。"},
            {"读书不一定每次都要得到答案。","看到喜欢的句子，停下来想一想，比匆忙读完更有意思。","下次再读同一本书，也许会在不同的地方停下来。","待读：一本关于日常观察的小书。"},
            {"想到一个小点子：把每天看见的一种颜色记下来。","可以从窗外的天空开始。","不急着把灵感做完，先让它有个可以待着的地方。"}
        };
        for(int i=0;i<3;i++) {
            JSONObject room=createRoom(new JSONObject().put("name",roomNames[i]).put("categoryId",categories[i]));
            for(int m=0;m<messages[i].length;m++) {
                JSONObject sent=sendMessage(new JSONObject().put("roomId",room.getString("id")).put("clientId",uuid()).put("text",messages[i][m]));
                String time=UTC_TIME.format(Instant.now().minusSeconds((messages[i].length-m)*900L+i*3600L));
                ContentValues v=new ContentValues();v.put("eventTime",time);db.update("messages",v,"id=?",new String[]{sent.getString("id")});
            }
        }
    }
}
