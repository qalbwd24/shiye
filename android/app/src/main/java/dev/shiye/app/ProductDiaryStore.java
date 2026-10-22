package dev.shiye.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * One complete journalAggregate authority on LocalStore's ProductRepository connection.
 * The JS shared prepareProductEntry call runs before save; this class never converts HTML,
 * reconstructs an Entry from a screen DTO, or invents canonical IDs/timestamps.
 */
public final class ProductDiaryStore {
    private static final String TYPE = "journalAggregate";
    private static final Set<String> EDITABLE = new HashSet<>(Arrays.asList(
        "title", "date", "category", "categoryId", "tags", "attachments", "body",
        "pinned", "deleted", "hidden", "draftOnly", "mood", "weather", "location"));
    private static final Set<String> DERIVED = new HashSet<>(Arrays.asList(
        "content", "messageUnits", "_canonical", "revision", "updatedAt", "contentEditedAt",
        "preview", "searchText", "wordCount"));
    private final ProductRepository repository;
    private final ProductPayloadWriter payloadWriter;

    public ProductDiaryStore(ProductRepository repository) {
        if (repository == null) throw new IllegalArgumentException("PRODUCT_REPOSITORY_REQUIRED");
        this.repository = repository;this.payloadWriter=null;
    }
    /** Explicit backend candidate only; the legacy/default constructor never enables writes. */
    public ProductDiaryStore(ProductRepository repository,ProductPayloadWriter writer,JSONObject catalog)throws Exception{
        if(repository==null||writer==null)throw new IllegalArgumentException("PRODUCT_PAYLOAD_WRITER_REQUIRED");
        if(!supportsPayloadWrites(catalog))throw new java.io.IOException("PRODUCT_PAYLOAD_WRITES_UNSUPPORTED");
        this.repository=repository;this.payloadWriter=writer;
    }
    public static boolean supportsPayloadWrites(JSONObject catalog){JSONObject capability=catalog==null?null:catalog.optJSONObject("payloadWrites");return capability!=null&&capability.optInt("version")==1&&"strict-base-revision".equals(capability.optString("conflict"))&&capability.optLong("maxBytes")>=ProductPayloadWriter.MAX_BYTES;}

    /** Full local record, including base, pending local value, unknown fields and canonical. */
    public JSONObject read(String entryId) throws Exception {
        requireId(entryId);
        JSONObject record=repository.load(TYPE, entryId);if(record!=null&&ProductPayloadReader.packed(record.optJSONObject("local"))){record.put("local",ProductPayloadReader.hydrate(repository,record.getJSONObject("local"))).put("payloadReadOnly",payloadWriter==null);if(payloadWriter==null)record.put("readOnlyReason","PRODUCT_PAYLOAD_EDIT_PORT_REQUIRED");}return record;
    }

    /** Derived directly from authoritative records; no second index can go stale after pull. */
    public JSONArray list() throws Exception {
        JSONArray result = new JSONArray();
        JSONArray records = repository.records();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (!TYPE.equals(record.optString("entityType"))) continue;
            JSONObject local = record.optJSONObject("local");
            boolean packed=ProductPayloadReader.packed(local),payloadPending=false;
            if(packed)try{local=ProductPayloadReader.hydrate(repository,local);}catch(java.io.IOException unavailable){payloadPending=true;}
            JSONObject data = local == null ? null : local.optJSONObject("data");
            JSONObject item = new JSONObject()
                .put("id", record.getString("entityId"))
                .put("localRevision", record.getLong("localRevision"))
                .put("localOnly", record.optBoolean("localOnly"))
                .put("state", local == null ? "unavailable" : local.optString("state", "active"))
                .put("title", data == null ? "" : data.optString("title", ""))
                .put("date", data == null ? JSONObject.NULL : data.opt("date"))
                .put("updatedAt", data == null ? JSONObject.NULL : data.opt("updatedAt"));
            JSONObject refs = data == null ? null : data.optJSONObject("_product") == null
                ? null : data.getJSONObject("_product").optJSONObject("refs");
            item.put("categoryRef", refs == null ? JSONObject.NULL : refs.opt("category"));
            item.put("tagRefs", refs == null ? new JSONArray() : cloneValue(refs.opt("tags")));
            if(packed)item.put("payloadReadOnly",payloadWriter==null).put("payloadPending",payloadPending);
            result.put(item);
        }
        return result;
    }

    /**
     * `preparedRecord` is the exact shared prepareProductEntry result
     * {entityType,entityId,data}; `dirtyFields` are user-edited Entry field names.
     * Returns after the SQLite commit. No network call is made.
     */
    public JSONObject save(JSONObject preparedRecord, JSONArray dirtyFields, long expectedLocalRevision) throws Exception {
        if (expectedLocalRevision < 0) throw new IllegalArgumentException("INVALID_LOCAL_REVISION");
        JSONObject prepared = copy(preparedRecord);
        Set<String> dirty = validateDirty(dirtyFields);
        validatePrepared(prepared);
        String id = prepared.getString("entityId");
        JSONObject before = repository.load(TYPE, id);
        JSONObject previous = before == null ? null : before.optJSONObject("local");
        boolean previousPacked=ProductPayloadReader.packed(previous);
        if(previousPacked){if(payloadWriter==null)throw new java.io.IOException("PRODUCT_PAYLOAD_EDIT_PORT_REQUIRED");previous=ProductPayloadReader.hydrate(repository,previous);}
        if (before != null && before.optLong("localRevision", -1) != expectedLocalRevision)
            throw new IllegalStateException("LOCAL_REVISION_CONFLICT");
        if (previous != null && "withdrawn".equals(previous.optString("state")))
            throw new IllegalStateException("ENTITY_WITHDRAWN");
        validatePreserved(previous == null ? null : previous.optJSONObject("data"), prepared.getJSONObject("data"), dirty);
        if (before != null && dirty.isEmpty()) {
            if (!same(previous.opt("data"), prepared.opt("data")))
                throw new IllegalArgumentException("UNDECLARED_ENTRY_CHANGE");
            return before;
        }
        JSONObject envelope = new JSONObject()
            .put("entityType", TYPE).put("entityId", id).put("revision", 0)
            .put("state", previous == null ? "active" : previous.optString("state", "active"))
            .put("data", prepared.getJSONObject("data"));
        JSONObject metadata = repository.metadata();
        // A new offline draft remains local-only, even before pairing or a first snapshot.
        // An existing local-only Entry also remains local-only until explicit migration.
        if (metadata.optJSONObject("identity") == null ||
            (before != null && before.optBoolean("localOnly") && !hasQueuedIntent(id))) {
            if(payloadWriter!=null&&prepared.getJSONObject("data").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>ProductPayloadWriter.INLINE_BYTES){
                ProductPayloadWriter.Prepared packed=payloadWriter.prepare(prepared);JSONObject original=packed.original(),localEnvelope=new JSONObject(envelope.toString()).put("data",packed.record().getJSONObject("data"));
                return repository.transaction(tx->{JSONObject current=tx.getEntity(TYPE,id);if(!same(current==null?null:current.optJSONObject("base"),before==null?null:before.optJSONObject("base")))throw new java.io.IOException("PRODUCT_PAYLOAD_BASE_CHANGED");JSONObject old=tx.getMapping("product-original019",original.getString("assetId"));if(old==null)tx.putMapping("product-original019",original.getString("assetId"),original);else if(!old.optString("sha256").equals(original.getString("sha256"))||old.optLong("size",-1)!=original.getLong("size"))throw new java.io.IOException("PRODUCT_PAYLOAD_FILE_CONFLICT");return tx.preserveLocalOnly(localEnvelope,expectedLocalRevision);});
            }
            return repository.transaction(tx -> tx.preserveLocalOnly(envelope, expectedLocalRevision));
        }
        if(payloadWriter!=null&&(previousPacked||prepared.getJSONObject("data").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>ProductPayloadWriter.INLINE_BYTES||hasPayloadIntent(id))){
            ProductPayloadWriter.Prepared packed=payloadWriter.prepare(prepared);JSONObject original=packed.original(),wireData=packed.record().getJSONObject("data");
            return repository.enqueuePayloadEntry(prepared,dirtyFields,wireData,original,before==null?null:before.optJSONObject("base"),expectedLocalRevision,(tx,job)->ProductLocalSelection.dependencies(tx,prepared.getJSONObject("data")));
        }
        JSONObject intent = new JSONObject().put("entityType", TYPE).put("entityId", id);
        if (before == null || before.optJSONObject("base") == null) {
            intent.put("command", "create").put("data", copy(prepared.getJSONObject("data")));
        } else {
            JSONObject changes = new JSONObject();
            JSONObject data = prepared.getJSONObject("data");
            JSONObject old = previous == null ? null : previous.optJSONObject("data");
            for (Iterator<String> names = data.keys(); names.hasNext();) {
                String key = names.next();
                if (old == null || !same(old.opt(key), data.opt(key))) changes.put(key, cloneValue(data.get(key)));
            }
            intent.put("command", "updateFields").put("changes", changes);
        }
        // The repository's ordinary enqueueIntent intentionally rejects canonical edits.
        // This dedicated port must verify the complete prepared record before enqueueing.
        return repository.enqueuePreparedEntryIntent(intent, expectedLocalRevision, prepared, (tx,job)->ProductLocalSelection.dependencies(tx,prepared.getJSONObject("data")));
    }

    private boolean hasQueuedIntent(String entryId) throws Exception {
        JSONArray pending = repository.pending();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject intent = pending.getJSONObject(i).optJSONObject("intent");
            if (intent != null && TYPE.equals(intent.optString("entityType")) && entryId.equals(intent.optString("entityId"))) return true;
        }
        return false;
    }
    private boolean hasPayloadIntent(String entryId)throws Exception{JSONArray jobs=repository.pending();for(int i=0;i<jobs.length();i++){JSONObject job=jobs.getJSONObject(i),intent=job.optJSONObject("intent");if(job.optBoolean("payloadWrite")&&intent!=null&&TYPE.equals(intent.optString("entityType"))&&entryId.equals(intent.optString("entityId")))return true;}return false;}

    /** Explicit, one Entry at a time preservation from an old SQLite row after JS preparation. */
    public JSONObject preserveLegacyEntry(JSONObject preparedRecord, String legacyId) throws Exception {
        requireId(legacyId);
        JSONObject prepared = copy(preparedRecord);
        validatePrepared(prepared);
        String id = prepared.getString("entityId");
        JSONObject envelope = new JSONObject().put("entityType", TYPE).put("entityId", id)
            .put("revision", 0).put("state", "active").put("data", prepared.getJSONObject("data"));
        return repository.transaction(tx -> {
            if (tx.getEntity(TYPE, id) != null) throw new IllegalStateException("ENTRY_ALREADY_MAPPED");
            JSONObject mapping = new JSONObject().put("entityType", TYPE).put("entityId", id);
            tx.putMapping("legacy-entry", legacyId, mapping);
            return tx.preserveLocalOnly(envelope, 0);
        });
    }

    /** After identity verification and initial receive, explicitly queue one preserved local Entry. */
    public JSONObject queueLocalOnly(String entryId, long expectedLocalRevision) throws Exception {
        requireId(entryId);
        JSONObject record = repository.load(TYPE, entryId);
        if (record == null || !record.optBoolean("localOnly") || record.optLong("localRevision", -1) != expectedLocalRevision)
            throw new IllegalStateException("LOCAL_ONLY_REVISION_REQUIRED");
        if (repository.metadata().optJSONObject("identity") == null)
            throw new IllegalStateException("LIBRARY_IDENTITY_REQUIRED");
        JSONObject local = record.optJSONObject("local");
        if (local == null || !"active".equals(local.optString("state")))
            throw new IllegalStateException("LOCAL_ONLY_ENTRY_UNAVAILABLE");
        if(ProductPayloadReader.packed(local)){if(payloadWriter==null)throw new java.io.IOException("PRODUCT_PAYLOAD_EDIT_PORT_REQUIRED");local=ProductPayloadReader.hydrate(repository,local);}
        JSONObject prepared = new JSONObject().put("entityType", TYPE).put("entityId", entryId)
            .put("data", copy(local.getJSONObject("data")));
        validatePrepared(prepared);
        JSONObject intent = new JSONObject().put("entityType", TYPE).put("entityId", entryId)
            .put("command", "create").put("data", copy(prepared.getJSONObject("data")));
        if(payloadWriter!=null&&prepared.getJSONObject("data").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>ProductPayloadWriter.INLINE_BYTES){ProductPayloadWriter.Prepared packed=payloadWriter.prepare(prepared);return repository.enqueuePayloadEntry(prepared,new JSONArray(),packed.record().getJSONObject("data"),packed.original(),record.optJSONObject("base"),expectedLocalRevision,(tx,job)->ProductLocalSelection.dependencies(tx,prepared.getJSONObject("data")));}
        return repository.enqueuePreparedEntryIntent(intent, expectedLocalRevision, prepared, (tx,job)->ProductLocalSelection.dependencies(tx,prepared.getJSONObject("data")));
    }

    public JSONObject legacyMapping(String legacyId) throws Exception {
        requireId(legacyId);
        return repository.transaction(tx -> tx.getMapping("legacy-entry", legacyId));
    }

    static void validatePrepared(JSONObject prepared) throws Exception {
        if (prepared == null || !TYPE.equals(prepared.opt("entityType"))) throw new IllegalArgumentException("COMPLETE_PRODUCT_RECORD_REQUIRED");
        String id = prepared.getString("entityId"); requireId(id);
        JSONObject data = prepared.optJSONObject("data");
        if (data == null || !id.equals(data.opt("id")) || data.has("chatJournal"))
            throw new IllegalArgumentException("COMPLETE_PRODUCT_RECORD_REQUIRED");
        JSONObject product = data.optJSONObject("_product");
        if (product == null || product.optInt("schema") != 1 || !"entry".equals(product.opt("kind")) || product.optJSONObject("refs") == null)
            throw new IllegalArgumentException("PRODUCT_REFS_REQUIRED");
        if (!"richdoc".equals(data.opt("contentFormat")))
            throw new IllegalArgumentException("UNSUPPORTED_ORIGINAL_FORMAT_READ_ONLY");
        JSONObject body = data.optJSONObject("body");
        if (body == null || !"shiye-richdoc".equals(body.opt("format")) || body.optInt("version") != 1 || body.optJSONArray("content") == null)
            throw new IllegalArgumentException("COMPLETE_RICHDOC_REQUIRED");
        JSONObject units = data.optJSONObject("messageUnits"), canonical = data.optJSONObject("_canonical");
        if (units == null || !"messageStore".equals(units.opt("authority")) || units.optJSONArray("ids") == null ||
            canonical == null || canonical.optJSONArray("units") == null || canonical.optJSONObject("layout") == null)
            throw new IllegalArgumentException("CANONICAL_PREPARATION_REQUIRED");
        JSONArray issues = canonical.getJSONObject("layout").optJSONArray("issues");
        if (issues != null) for (int i=0; i<issues.length(); i++) {
            JSONObject issue=issues.optJSONObject(i);
            if (issue != null && "missing-media".equals(issue.optString("code")))
                throw new IllegalArgumentException("MEDIA_METADATA_REQUIRED");
        }
        JSONObject refs = product.getJSONObject("refs");
        if (refs.has("category") && !(refs.opt("category") instanceof String) && !refs.isNull("category"))
            throw new IllegalArgumentException("CATEGORY_REF_REQUIRED");
        if (refs.has("tags")) {
            JSONArray tags = refs.optJSONArray("tags"); if (tags == null) throw new IllegalArgumentException("TAG_REFS_REQUIRED");
            for (int i = 0; i < tags.length(); i++) if (!(tags.get(i) instanceof String)) throw new IllegalArgumentException("TAG_REFS_REQUIRED");
        }
        if (data.has("categoryId") && !data.isNull("categoryId") && !refs.has("category"))
            throw new IllegalArgumentException("CATEGORY_REF_REQUIRED");
        if (data.optJSONArray("tags") != null && data.getJSONArray("tags").length() > 0 && !refs.has("tags"))
            throw new IllegalArgumentException("TAG_REFS_REQUIRED");
    }

    private static void validatePreserved(JSONObject old, JSONObject next, Set<String> dirty) throws Exception {
        if (old == null) return;
        for (Iterator<String> names = old.keys(); names.hasNext();) {
            String key = names.next();
            if (!next.has(key)) throw new IllegalArgumentException("UNKNOWN_FIELD_DROPPED:" + key);
            if (!dirty.contains(key) && !DERIVED.contains(key) && !key.equals("_product") && !same(old.opt(key), next.opt(key)))
                throw new IllegalArgumentException("UNDECLARED_ENTRY_CHANGE:" + key);
        }
        JSONObject oldProduct = old.optJSONObject("_product"), newProduct = next.optJSONObject("_product");
        if (oldProduct != null && newProduct != null) {
            for (Iterator<String> names = oldProduct.keys(); names.hasNext();) {
                String key = names.next(); if (!newProduct.has(key)) throw new IllegalArgumentException("UNKNOWN_PRODUCT_FIELD_DROPPED:" + key);
                if (!"refs".equals(key) && !same(oldProduct.opt(key), newProduct.opt(key))) throw new IllegalArgumentException("PRODUCT_ANNOTATION_CHANGED:" + key);
            }
            JSONObject oldRefs = oldProduct.optJSONObject("refs"), newRefs = newProduct.optJSONObject("refs");
            if (oldRefs != null) for (Iterator<String> names = oldRefs.keys(); names.hasNext();) {
                String key = names.next();
                if (!newRefs.has(key)) throw new IllegalArgumentException("UNKNOWN_REF_DROPPED:" + key);
                if (!same(oldRefs.opt(key), newRefs.opt(key)) &&
                    !("category".equals(key) && (dirty.contains("category") || dirty.contains("categoryId"))) &&
                    !("tags".equals(key) && dirty.contains("tags")) &&
                    !("assets".equals(key) && (dirty.contains("body") || dirty.contains("attachments"))))
                    throw new IllegalArgumentException("UNDECLARED_REF_CHANGE:" + key);
            }
        }
        boolean contentDirty = dirty.contains("body") || dirty.contains("attachments");
        if (!contentDirty && !same(old.opt("contentEditedAt"), next.opt("contentEditedAt")))
            throw new IllegalArgumentException("CONTENT_CLOCK_CHANGED_WITHOUT_BODY");
        if (!dirty.contains("body") && !same(old.opt("body"), next.opt("body")))
            throw new IllegalArgumentException("BODY_CHANGED_WITHOUT_DIRTY_FIELD");
        if (!contentDirty && old.has("_canonical") && !same(old.opt("_canonical"), next.opt("_canonical")))
            throw new IllegalArgumentException("CANONICAL_CHANGED_WITHOUT_BODY");
    }

    private static Set<String> validateDirty(JSONArray fields) throws Exception {
        if (fields == null) throw new IllegalArgumentException("DIRTY_FIELDS_REQUIRED");
        Set<String> result = new HashSet<>();
        for (int i = 0; i < fields.length(); i++) {
            String field = fields.getString(i);
            if (!EDITABLE.contains(field) || !result.add(field)) throw new IllegalArgumentException("INVALID_DIRTY_FIELD:" + field);
        }
        return result;
    }
    private static void requireId(String id) {
        if (id == null || !id.matches("[A-Za-z0-9_:@.-]{1,160}")) throw new IllegalArgumentException("INVALID_ENTRY_ID");
    }
    private static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }
    private static Object cloneValue(Object value) throws Exception {
        if (value instanceof JSONObject) return copy((JSONObject)value);
        if (value instanceof JSONArray) return new JSONArray(value.toString());
        return value;
    }
    private static boolean same(Object left, Object right) {
        if (left == null || left == JSONObject.NULL) return right == null || right == JSONObject.NULL;
        if (right == null || right == JSONObject.NULL) return false;
        if (left instanceof JSONObject && right instanceof JSONObject) {
            JSONObject a = (JSONObject)left, b = (JSONObject)right;
            if (a.length() != b.length()) return false;
            for (Iterator<String> names=a.keys(); names.hasNext();) {
                String key=names.next(); if (!b.has(key) || !same(a.opt(key),b.opt(key))) return false;
            }
            return true;
        }
        if (left instanceof JSONArray && right instanceof JSONArray) {
            JSONArray a=(JSONArray)left,b=(JSONArray)right; if(a.length()!=b.length()) return false;
            for(int i=0;i<a.length();i++) if(!same(a.opt(i),b.opt(i))) return false;
            return true;
        }
        return left.equals(right);
    }
}
