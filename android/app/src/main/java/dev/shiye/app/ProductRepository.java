package dev.shiye.app;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Native persistence port for sync-v2-client's base/intent/rebuild semantics.
 * The supplied database MUST be LocalStore's connection, not a mirror database.
 * No network, credentials, UI dispatch, TL migration, or body preparation lives here.
 * Full envelopes are authoritative; base is the immutable remote merge baseline.
 * Any legacy entries projection must be maintained by Projection in this transaction.
 */
public final class ProductRepository {
    private static final String RECORDS = "product017_records";
    private static final String PENDING = "product017_pending";
    private static final String META = "product017_meta";
    private static final String CONFLICTS = "product017_conflicts";
    private static final String MAPPINGS = "product017_mappings";
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private static final Set<String> COMMANDS = new HashSet<>(Arrays.asList("create", "updateFields", "delete", "withdraw", "restore"));
    private static final Set<String> PRODUCT_COMMANDS = new HashSet<>(Arrays.asList("sendMessages", "withdrawMessage", "addComment", "withdrawComment"));
    private static final Set<String> EDITABLE_TYPES = new HashSet<>(Arrays.asList("journalAggregate", "conversation", "taxonomy", "order", "appearance", "profile", "sticker", "commandMapping", "relation"));
    private final SQLiteDatabase db;
    private final Projection projection;

    public static final class RepositoryException extends Exception {
        public final String code;
        RepositoryException(String code) { super(code); this.code = code; }
    }
    @FunctionalInterface public interface Work<T> { T run(Tx tx) throws Exception; }
    @FunctionalInterface public interface LocalCommit { void commit(Tx tx, JSONObject job) throws Exception; }
    @FunctionalInterface public interface Receipt { void apply(Tx tx, JSONObject job, JSONObject receipt) throws Exception; }
    @FunctionalInterface public interface Projection { void update(Tx tx, JSONObject record) throws Exception; }
    @FunctionalInterface interface SeedRows { void read(SeedRow visitor) throws Exception; }
    @FunctionalInterface interface SeedRow { void accept(JSONObject entity) throws Exception; }
    @FunctionalInterface interface SeedResources { void commit(Tx tx) throws Exception; }
    @FunctionalInterface interface SeedCheck { void active() throws Exception; }

    public ProductRepository(SQLiteDatabase database) { this(database, null); }
    public ProductRepository(SQLiteDatabase database, Projection projection) {
        if (database == null) throw new IllegalArgumentException("EXPLICIT_DATABASE_REQUIRED");
        this.db = database; this.projection = projection;
    }

    /** Additive only. Caller chooses the explicit LocalStore upgrade boundary. */
    public void initialize() throws Exception {
        transaction(tx -> {
            db.execSQL("CREATE TABLE IF NOT EXISTS " + RECORDS + "(entityType TEXT NOT NULL,entityId TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(entityType,entityId))");
            db.execSQL("CREATE TABLE IF NOT EXISTS " + PENDING + "(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operationId TEXT NOT NULL UNIQUE,lane TEXT NOT NULL,job TEXT NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS " + META + "(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS " + CONFLICTS + "(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS " + MAPPINGS + "(kind TEXT NOT NULL,localId TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,localId))");
            return null;
        });
    }

    /** Returns only after SQLite endTransaction; exceptions roll back every write. */
    public <T> T transaction(Work<T> work) throws Exception {
        synchronized (db) {
            if (db.inTransaction()) throw error("OUTER_TRANSACTION_USE_CURRENT_TX");
            db.beginTransaction();
            Tx tx = new Tx();
            try {
                T value = work.run(tx);
                db.setTransactionSuccessful();
                return value;
            } finally { tx.active = false; db.endTransaction(); }
        }
    }

    /** Outer LocalStore dispatch owns commit/rollback AND may acknowledge only after endTransaction. */
    public <T> T inCurrentTransaction(Work<T> work) throws Exception {
        if (!db.inTransaction()) throw error("LOCAL_TRANSACTION_REQUIRED");
        Tx tx = new Tx();
        try { return work.run(tx); } finally { tx.active = false; }
    }

    public JSONObject load(String type, String id) throws Exception { return transaction(tx -> tx.getEntity(type, id)); }
    public JSONObject metadata() throws Exception { return transaction(Tx::getMeta); }
    public JSONArray records() throws Exception { return transaction(Tx::listEntities); }
    public JSONArray pending() throws Exception { return transaction(tx -> tx.listPending(null)); }
    public JSONArray conflicts() throws Exception { return transaction(Tx::listConflicts); }
    /** Connection-page counters never materialize entity bodies or outbox payloads. */
    public JSONObject status() throws Exception {
        return transaction(tx -> {
            JSONObject meta=tx.getMeta();
            return new JSONObject().put("metadata",meta).put("initialized",meta.optBoolean("initialized"))
                .put("records",tx.count(RECORDS)).put("pending",tx.count(PENDING)).put("conflicts",tx.count(CONFLICTS))
                .put("messageAuthority","legacy-tl-not-migrated").put("contentSyncEnabled",false);
        });
    }
    public void bindIdentity(JSONObject info) throws Exception { transaction(tx -> { tx.bindIdentity(info); return null; }); }
    /** Only the verified file backend calls this port. Files/network are prepared beforehand. */
    JSONObject importSeed(JSONObject manifest,String sha256,JSONObject proof,SeedRows source,SeedResources resources,SeedCheck cancellation)throws Exception{
        if(sha256==null||!sha256.matches("[a-f0-9]{64}")||source==null||resources==null||!Boolean.TRUE.equals(proof.opt("verified"))||!sha256.equals(proof.optString("sha256")))throw error("SEED_PROOF_MISMATCH");
        for(String field:new String[]{"packageId","libraryId","epoch","checkpoint","watermark","policy"})if(!same(manifest.opt(field),proof.opt(field)))throw error("SEED_PROOF_MISMATCH");
        JSONArray redactions=proof.optJSONArray("redactions");if(redactions==null)throw error("SEED_PROOF_MISMATCH");
        for(JSONObject redaction:objects(redactions))if("active".equals(redaction.optString("state"))||redaction.optJSONObject("data")==null||redaction.getJSONObject("data").length()!=0)throw error("SEED_REDACTION_INVALID");
        return transaction(tx->{
            cancellation.active();JSONObject expected=new JSONObject().put("libraryId",manifest.getString("libraryId")).put("epoch",manifest.getString("epoch"));tx.guardIdentity(expected);
            JSONObject meta=tx.getMeta();JSONArray packages=meta.optJSONArray("seedPackages");if(packages!=null)for(int i=0;i<packages.length();i++)if(sha256.equals(packages.getString(i)))return new JSONObject().put("imported",false).put("replayed",true);
            if(meta.optBoolean("initialized")||meta.has("snapshotCursor"))throw error("SEED_TARGET_ALREADY_INITIALIZED");
            Set<String> businessPending=new HashSet<>();for(JSONObject job:objects(tx.listPending("command")))businessPending.add(job.getString("operationId"));
            final long[] count={0};source.read(entity->{cancellation.active();if(++count[0]>100000)throw error("SEED_LIMIT_EXCEEDED");JSONObject old=tx.getEntity(entity.getString("entityType"),entity.getString("entityId"));if(old!=null&&old.optBoolean("localOnly")&&tx.pendingFor(entity.getString("entityType"),entity.getString("entityId")).length()==0&&!businessPending.contains(old.optString("businessOperationId")))throw error("SEED_LOCAL_ONLY_ID_COLLISION");tx.acceptEntity(entity);});
            if(count[0]!=number(manifest,"entityCount",0))throw error("SEED_RECORD_COUNT_MISMATCH");
            for(JSONObject redaction:objects(redactions)){cancellation.active();tx.acceptEntity(redaction);}
            resources.commit(tx);cancellation.active();meta=tx.getMeta();packages=meta.optJSONArray("seedPackages");if(packages==null)packages=new JSONArray();packages.put(sha256);while(packages.length()>16)packages.remove(0);
            meta.put("initialized",true).put("cursor",manifest.getString("checkpoint")).put("seedCatchUpRequired",true).put("seedPackages",packages).put("seedPolicy",copy(manifest.getJSONObject("policy")));
            tx.setMeta(meta);return new JSONObject().put("imported",true).put("entities",count[0]).put("catchUpRequired",true);
        });
    }
    public JSONObject enqueueIntent(JSONObject intent, long expectedLocalRevision, LocalCommit commit) throws Exception {
        return transaction(tx -> tx.enqueueIntent(intent, expectedLocalRevision, commit));
    }
    /** Fixed entry adapter only: the shared JS preparation runs before this native guard. */
    public JSONObject enqueuePreparedEntryIntent(JSONObject intent, long expectedLocalRevision, JSONObject preparedRecord, LocalCommit commit) throws Exception {
        return transaction(tx -> tx.enqueuePreparedEntryIntent(intent, expectedLocalRevision, preparedRecord, commit));
    }
    /** CAS payload lane. Full local snapshots remain separate from immutable transport bytes. */
    public JSONObject enqueuePayloadEntry(JSONObject prepared,JSONArray dirty,JSONObject wireData,JSONObject original,JSONObject expectedBase,long expectedLocalRevision,LocalCommit commit)throws Exception{
        return transaction(tx->{
            String id=prepared.getString("entityId");JSONObject data=prepared.getJSONObject("data");validatePreparedEntry(data,id);
            JSONObject record=tx.getEntity("journalAggregate",id);if(record==null)record=blankRecord("journalAggregate",id);
            long revision=number(record,"localRevision",0);if(revision!=expectedLocalRevision)throw error("LOCAL_REVISION_CONFLICT");
            JSONObject base=record.optJSONObject("base");if(!same(base,expectedBase))throw error("PRODUCT_PAYLOAD_BASE_CHANGED");if(base!=null&&!"active".equals(base.optString("state")))throw error("ENTITY_NOT_ACTIVE");
            JSONObject bound=tx.getMeta().optJSONObject("identity");tx.guardIdentity(bound);
            JSONArray prior=tx.pendingFor("journalAggregate",id);long baseRevision=base==null?0:number(base,"revision",1);
            if(prior.length()>0){JSONObject last=prior.getJSONObject(prior.length()-1).optJSONObject("wire");baseRevision=last==null?baseRevision+prior.length():number(last,"baseRevision",0)+1;}
            String command=baseRevision==0?"create":"updateFields",operation=operationId();
            // Complete logical snapshot bytes live in the verified content-addressed original.
            // Keeping only its pointer here avoids Android CursorWindow's per-row TEXT limit.
            JSONObject intent=new JSONObject().put("entityType","journalAggregate").put("entityId",id).put("command",command).put(command.equals("create")?"data":"changes",copy(wireData));
            JSONObject wire=new JSONObject().put("entityType","journalAggregate").put("entityId",id).put("command",command).put("operationId",operation).put("baseRevision",baseRevision).put(command.equals("create")?"data":"changes",copy(wireData));
            if(wire.toString().getBytes(StandardCharsets.UTF_8).length>1024*1024)throw error("SYNC_OPERATION_TOO_LARGE");
            JSONObject full=new JSONObject().put("entityType","journalAggregate").put("entityId",id).put("revision",baseRevision).put("state","active").put("data",copy(wireData));
            JSONObject job=new JSONObject().put("operationId",operation).put("identity",copy(bound)).put("intent",intent).put("wire",wire).put("payloadWrite",true).put("preparedEntry",full).put("dirtyFields",new JSONArray(dirty.toString())).put("localRevision",nextRevision(revision));
            if(original!=null){String assetId=original.getString("assetId");JSONObject old=tx.getMapping("product-original019",assetId);if(old==null)tx.putMapping("product-original019",assetId,original);else if(!old.optString("sha256").equals(original.getString("sha256"))||old.optLong("size",-1)!=original.getLong("size"))throw error("PRODUCT_PAYLOAD_FILE_CONFLICT");job.put("payloadAssetId",assetId);}
            record.put("localRevision",nextRevision(revision));tx.putPending(job,"entity");tx.rebuild(record);if(commit!=null)commit.commit(tx,copy(job));return new JSONObject().put("operationId",operation).put("record",tx.getEntity("journalAggregate",id));
        });
    }
    public void blockPayloadOperation(String operation)throws Exception{transaction(tx->{JSONObject job=tx.getPending(operation,"entity");if(job!=null){job.put("blocked","PRODUCT_PAYLOAD_REBASE_REQUIRED");tx.putPending(job,"entity");tx.putConflict(new JSONObject().put("operationId",operation).put("status","PRODUCT_PAYLOAD_REBASE_REQUIRED").put("conflictId",JSONObject.NULL));}return null;});}
    public JSONObject enqueueCommand(String action, JSONObject input, JSONObject identity, LocalCommit commit) throws Exception {
        return transaction(tx -> tx.enqueueCommand(action, input, identity, commit));
    }
    public JSONObject prepareNextPush(JSONObject identity) throws Exception { return transaction(tx -> tx.prepareNextPush(identity)); }
    public void applyRemotePage(String mode, Object requestedCursor, JSONObject page, JSONObject identity) throws Exception {
        transaction(tx -> { tx.applyRemotePage(mode, requestedCursor, page, identity); return null; });
    }
    public void ackOperation(String operationId, JSONObject result, JSONObject identity) throws Exception {
        transaction(tx -> { tx.ackOperation(operationId, result, identity); return null; });
    }
    public JSONObject nextCommand(JSONObject identity) throws Exception { return transaction(tx -> { tx.guardIdentity(identity);if(tx.getMeta().optBoolean("seedCatchUpRequired"))throw error("SEED_CATCH_UP_REQUIRED"); return tx.firstCommand(); }); }
    public void ackCommand(String operationId, JSONObject receipt, JSONObject identity, Receipt apply) throws Exception {
        transaction(tx -> { tx.ackCommand(operationId, receipt, identity, apply); return null; });
    }

    public final class Tx {
        private final Thread owner = Thread.currentThread();
        private boolean active = true;
        private void check() throws Exception {
            if (!active || owner != Thread.currentThread() || !db.inTransaction()) throw error("EXPIRED_LOCAL_TRANSACTION");
        }
        /** Synchronous local SQL only; no nested transaction or async/network callback. */
        public SQLiteDatabase database() throws Exception { check(); return db; }
        private long count(String table) throws Exception {
            check(); try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM "+table,null)){c.moveToFirst();return c.getLong(0);}
        }
        public JSONObject getMeta() throws Exception {
            check();
            try (Cursor c = db.rawQuery("SELECT value FROM " + META + " WHERE singleton=1", null)) {
                return c.moveToFirst() ? new JSONObject(c.getString(0)) : new JSONObject();
            }
        }
        public void setMeta(JSONObject value) throws Exception {
            check(); ContentValues v = new ContentValues(); v.put("singleton", 1); v.put("value", value.toString());
            db.insertWithOnConflict(META, null, v, SQLiteDatabase.CONFLICT_REPLACE);
        }
        public JSONObject getEntity(String type, String id) throws Exception {
            check(); requireString(type); requireString(id);
            try (Cursor c = db.rawQuery("SELECT record FROM " + RECORDS + " WHERE entityType=? AND entityId=?", new String[]{type,id})) {
                return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
            }
        }
        public JSONArray listEntities() throws Exception {
            check(); JSONArray values = new JSONArray();
            try (Cursor c = db.rawQuery("SELECT record FROM " + RECORDS + " ORDER BY entityType,entityId", null)) {
                while (c.moveToNext()) values.put(new JSONObject(c.getString(0)));
            }
            return values;
        }
        private void putRecord(JSONObject record) throws Exception {
            check(); ContentValues v = new ContentValues();
            v.put("entityType", strictString(record,"entityType")); v.put("entityId", strictString(record,"entityId")); v.put("record",record.toString());
            if (db.insertWithOnConflict(RECORDS,null,v,SQLiteDatabase.CONFLICT_REPLACE) < 0) throw error("REPOSITORY_STORAGE");
            if (projection != null) projection.update(this, copy(record));
        }
        /** Explicit preservation staging; NOT a remote base, NOT automatically uploaded. */
        public JSONObject preserveLocalOnly(JSONObject envelope, long expectedLocalRevision) throws Exception {
            check(); validateEnvelope(envelope, false);
            String type = strictString(envelope,"entityType"), id = strictString(envelope,"entityId");
            JSONObject old = getEntity(type,id);
            if (old != null && (!old.isNull("base") || pendingFor(type,id).length() != 0)) throw error("EXISTING_REMOTE_AUTHORITY");
            long revision = old == null ? 0 : number(old,"localRevision",0);
            if (revision != expectedLocalRevision) throw error("LOCAL_REVISION_CONFLICT");
            JSONObject record = old == null ? blankRecord(type,id) : old;
            record.put("local", cleanEnvelope(envelope)).put("localOnly", true).put("localRevision", nextRevision(revision));
            putRecord(record); return copy(record);
        }
        public JSONArray listPending(String lane) throws Exception {
            check(); JSONArray rows = new JSONArray();
            try (Cursor c = db.rawQuery("SELECT job FROM " + PENDING + (lane == null ? "" : " WHERE lane=?") + " ORDER BY sequence", lane == null ? null : new String[]{lane})) {
                while (c.moveToNext()) rows.put(new JSONObject(c.getString(0)));
            }
            return rows;
        }
        private JSONObject getPending(String id, String lane) throws Exception {
            try (Cursor c = db.rawQuery("SELECT job FROM " + PENDING + " WHERE operationId=? AND lane=?",new String[]{id,lane})) {
                return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
            }
        }
        private void putPending(JSONObject job, String lane) throws Exception {
            check(); String id = strictString(job,"operationId");
            ContentValues v = new ContentValues(); v.put("job", job.toString());
            if (db.update(PENDING,v,"operationId=? AND lane=?",new String[]{id,lane}) == 0) {
                v.put("operationId",id); v.put("lane",lane); db.insertOrThrow(PENDING,null,v);
            }
        }
        private void deletePending(String id) throws Exception { check(); db.delete(PENDING,"operationId=?",new String[]{id}); }
        public JSONArray listConflicts() throws Exception {
            check(); JSONArray rows = new JSONArray();
            try (Cursor c = db.rawQuery("SELECT value FROM " + CONFLICTS + " ORDER BY id", null)) {
                while (c.moveToNext()) rows.put(new JSONObject(c.getString(0)));
            }
            return rows;
        }
        public void putConflict(JSONObject value) throws Exception {
            check(); String id = strictString(value,"operationId"); ContentValues v = new ContentValues();
            v.put("id",id); v.put("value",value.toString()); db.insertWithOnConflict(CONFLICTS,null,v,SQLiteDatabase.CONFLICT_REPLACE);
        }
        public void putMapping(String kind, String localId, JSONObject value) throws Exception {
            check(); requireString(kind); requireString(localId);
            JSONObject old = getMapping(kind,localId);
            if (old != null && !same(old,value)) throw error("IDENTITY_MAPPING_CONFLICT");
            ContentValues v = new ContentValues(); v.put("kind",kind); v.put("localId",localId); v.put("value",value.toString());
            db.insertWithOnConflict(MAPPINGS,null,v,SQLiteDatabase.CONFLICT_REPLACE);
        }
        public JSONObject getMapping(String kind, String localId) throws Exception {
            check();
            try (Cursor c = db.rawQuery("SELECT value FROM " + MAPPINGS + " WHERE kind=? AND localId=?",new String[]{kind,localId})) {
                return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
            }
        }
        public void bindIdentity(JSONObject info) throws Exception {
            check(); if (number(info,"protocol",1) != 1) throw error("UNSUPPORTED_SYNC_PROTOCOL");
            JSONObject expected = identity(info), meta = getMeta(), old = meta.optJSONObject("identity");
            if (old != null && !same(old,expected)) throw error("SERVER_IDENTITY_MISMATCH");
            if (old == null) { meta.put("identity",expected); setMeta(meta); }
            guardIdentity(expected);
        }
        public void guardIdentity(JSONObject expected) throws Exception {
            check(); JSONObject actual = getMeta().optJSONObject("identity");
            if (actual == null || !same(actual, identity(expected))) throw error("SERVER_IDENTITY_MISMATCH");
            for (JSONObject item : objects(listPending(null))) {
                if (!same(actual,item.optJSONObject("identity"))) throw error("QUEUED_LIBRARY_MISMATCH");
            }
        }
        private JSONArray pendingFor(String type,String id) throws Exception {
            JSONArray selected = new JSONArray();
            for (JSONObject item : objects(listPending("entity"))) {
                JSONObject intent = item.getJSONObject("intent");
                if (type.equals(intent.opt("entityType")) && id.equals(intent.opt("entityId"))) selected.put(item);
            }
            return selected;
        }
        private void rebuild(JSONObject record) throws Exception {
            JSONObject base = record.optJSONObject("base"), local = base == null && record.optBoolean("localOnly") ? record.optJSONObject("local") : base;
            for (JSONObject pending : objects(pendingFor(record.getString("entityType"),record.getString("entityId")))) local = pending.optJSONObject("preparedEntry")!=null?copy(pending.getJSONObject("preparedEntry")):applyIntent(local,pending.getJSONObject("intent"));
            JSONObject business=record.optJSONObject("businessLocal");
            if(business!=null) {
                if(record.optBoolean("businessAcknowledged") && businessMatches(base,business)) {
                    record.remove("businessLocal");record.remove("businessOperationId");record.remove("businessAcknowledged");
                } else local=business;
            }
            if (base != null && "withdrawn".equals(base.opt("state"))) local = cleanEnvelope(base);
            record.put("local",local == null ? JSONObject.NULL : local);
            putRecord(record);
        }
        public JSONObject enqueueIntent(JSONObject input,long expectedLocalRevision,LocalCommit commit) throws Exception {
            return enqueueIntentInternal(input,expectedLocalRevision,null,commit);
        }
        public JSONObject enqueuePreparedEntryIntent(JSONObject input,long expectedLocalRevision,JSONObject preparedRecord,LocalCommit commit) throws Exception {
            check();
            if(!"journalAggregate".equals(input.optString("entityType")) || preparedRecord==null ||
                !"journalAggregate".equals(preparedRecord.optString("entityType")) ||
                !input.optString("entityId").equals(preparedRecord.optString("entityId"))) throw error("COMPLETE_PREPARED_ENTRY_REQUIRED");
            JSONObject record=getEntity("journalAggregate",input.getString("entityId"));
            JSONObject previous=record==null?null:record.optJSONObject("local");
            JSONObject candidate=applyIntent(previous,input);
            JSONObject data=preparedRecord.optJSONObject("data");
            if(data==null||!same(candidate.optJSONObject("data"),data))throw error("PREPARED_INTENT_MISMATCH");
            validatePreparedEntry(data,input.getString("entityId"));
            JSONObject old=previous==null?null:previous.optJSONObject("data");
            if(old!=null)for(Iterator<String> keys=old.keys();keys.hasNext();)if(!data.has(keys.next()))throw error("PREPARED_ENTRY_FIELD_DROPPED");
            return enqueueIntentInternal(input,expectedLocalRevision,preparedRecord,commit);
        }
        private JSONObject enqueueIntentInternal(JSONObject input,long expectedLocalRevision,JSONObject preparedRecord,LocalCommit commit) throws Exception {
            check(); JSONObject intent = copy(input);
            String type = strictString(intent,"entityType"), id = strictString(intent,"entityId"), command = strictString(intent,"command");
            if (!COMMANDS.contains(command)) throw error("INVALID_OPERATION");
            if (!EDITABLE_TYPES.contains(type)) throw error("PRODUCT_USE_BUSINESS_COMMAND");
            if (command.equals("updateFields") && !(intent.opt("changes") instanceof JSONObject)) throw error("INVALID_CHANGES");
            if (command.equals("create") && !(intent.opt("data") instanceof JSONObject)) throw error("INVALID_CREATE_DATA");
            intent.remove("operationId"); intent.remove("baseRevision"); intent.remove("deviceId");
            JSONObject meta = getMeta(), bound = meta.optJSONObject("identity"); guardIdentity(bound);
            JSONObject record = getEntity(type,id); if (record == null) record = blankRecord(type,id);
            long localRevision = number(record,"localRevision",0);
            if (localRevision != expectedLocalRevision) throw error("LOCAL_REVISION_CONFLICT");
            if ("withdrawn".equals(record.optJSONObject("base") == null ? "" : record.getJSONObject("base").opt("state"))) throw error("ENTITY_WITHDRAWN");
            // Enforce opaque/unsupported business kinds and source projections as read-only.
            JSONObject current = record.optJSONObject("local");
            JSONObject editable=current == null ? (command.equals("create") ? intent.optJSONObject("data") : null) : current.optJSONObject("data");
            if(preparedRecord!=null&&editable!=null) {editable=copy(editable);editable.remove("messageUnits");}
            ensureEditable(type,editable);
            String operationId = operationId();
            JSONObject job = new JSONObject().put("operationId",operationId).put("intent",intent).put("wire",JSONObject.NULL)
                .put("localRevision",nextRevision(localRevision)).put("identity",copy(bound));
            record.put("localRevision",nextRevision(localRevision));
            putPending(job,"entity"); rebuild(record);
            if (commit != null) commit.commit(this,copy(job));
            return new JSONObject().put("operationId",operationId).put("record",getEntity(type,id));
        }
        /** Local business overlay shares this record, transaction and revision with remote base. */
        public JSONObject putBusinessLocal(JSONObject envelope,long expectedLocalRevision,String operationId) throws Exception {
            check();validateEnvelope(envelope,false);
            String type=envelope.getString("entityType"),id=envelope.getString("entityId");
            if(!Arrays.asList("chatMessage","comment").contains(type))throw error("PRODUCT_INVALID_BUSINESS_TYPE");
            requireString(operationId);
            JSONObject record=getEntity(type,id);if(record==null)record=blankRecord(type,id);
            long revision=number(record,"localRevision",0);if(revision!=expectedLocalRevision)throw error("LOCAL_REVISION_CONFLICT");
            JSONObject base=record.optJSONObject("base");
            if(base!=null&&"withdrawn".equals(base.optString("state")))throw error("ENTITY_WITHDRAWN");
            if("withdrawn".equals(envelope.optString("state"))) {
                JSONObject old=record.optJSONObject("local"),oldData=old==null?null:old.optJSONObject("data");
                purgeCommandsForWithdrawal(envelope,oldData==null?"":oldData.optString("operationId",""));
                if(base!=null) {base=copy(base);base.put("data",new JSONObject());record.put("base",base).put("businessRedacted",true);}
            }
            record.put("localRevision",nextRevision(revision)).put("businessLocal",cleanEnvelope(envelope))
                .put("businessOperationId",operationId).put("businessAcknowledged",false).put("localOnly",base==null);
            rebuild(record);return copy(record);
        }
        public void markBusinessAcknowledged(String type,String id,String operationId) throws Exception {
            check();JSONObject record=getEntity(type,id);
            if(record==null||!operationId.equals(record.optString("businessOperationId")))return;
            record.put("businessAcknowledged",true);rebuild(record);
        }
        /** localCommit runs in this exact SQLite transaction, before the immutable command is inserted. */
        public JSONObject enqueueCommand(String action,JSONObject input,JSONObject expected,LocalCommit localCommit) throws Exception {
            check(); if (!PRODUCT_COMMANDS.contains(action) || localCommit == null) throw error("ATOMIC_LOCAL_COMMIT_REQUIRED");
            guardIdentity(expected); JSONObject payload = copy(input); String id = operationId();
            if (action.equals("addComment") && !payload.has("operationId")) payload.put("operationId",id);
            if (action.equals("withdrawComment") && !(payload.opt("operationId") instanceof String)) throw error("ORIGINAL_COMMENT_OPERATION_REQUIRED");
            checkCommandIds(action,payload);
            if (payload.toString().getBytes(StandardCharsets.UTF_8).length > 950000) throw error("PRODUCT_COMMAND_TOO_LARGE");
            JSONObject job = new JSONObject().put("operationId",id).put("id",id).put("action",action).put("input",payload).put("identity",identity(expected));
            localCommit.commit(this,copy(job));
            guardIdentity(expected); putPending(job,"command"); return copy(job);
        }
        public JSONObject prepareNextPush(JSONObject expected) throws Exception {
            check(); guardIdentity(expected);if(getMeta().optBoolean("seedCatchUpRequired"))throw error("SEED_CATCH_UP_REQUIRED"); Set<String> heads = new HashSet<>();
            List<JSONObject> ordered=new ArrayList<>(objects(listPending("entity")));
            ordered.sort(java.util.Comparator.comparingInt(item -> {
                String type=item.optJSONObject("intent").optString("entityType");
                return type.equals("taxonomy")?0:type.equals("relation")?1:type.equals("conversation")?2:3;
            }));
            for (JSONObject item : ordered) {
                JSONObject intent = item.getJSONObject("intent"); String type = intent.getString("entityType"), id = intent.getString("entityId");
                if (!heads.add(key(type,id)) || item.has("blocked")) continue;
                if (item.optJSONObject("wire") == null) {
                    JSONObject record = getEntity(type,id), base = record == null ? null : record.optJSONObject("base");
                    if (base != null && "withdrawn".equals(base.opt("state"))) { item.put("blocked","withdrawn"); putPending(item,"entity"); continue; }
                    JSONObject wire = copy(intent).put("operationId",item.getString("operationId")).put("baseRevision",base == null ? 0 : number(base,"revision",1));
                    if (wire.toString().getBytes(StandardCharsets.UTF_8).length > 1024*1024) throw error("SYNC_OPERATION_TOO_LARGE");
                    item.put("wire",wire); putPending(item,"entity");
                }
                return copy(item);
            }
            return null;
        }
        public void acceptEntity(JSONObject value) throws Exception {
            check(); validateEnvelope(value,true); JSONObject entity = cleanEnvelope(value);
            String type = entity.getString("entityType"), id = entity.getString("entityId");
            JSONObject record = getEntity(type,id); if (record == null) record = blankRecord(type,id);
            JSONObject previousLocal = record.optJSONObject("local");
            JSONObject previousData = previousLocal == null ? null : previousLocal.optJSONObject("data");
            String commentOperation = previousData == null ? "" : previousData.optString("operationId","");
            JSONObject base = record.optJSONObject("base");
            if (base == null || number(entity,"revision",1) >= number(base,"revision",1)) {
                if (base != null && "withdrawn".equals(base.opt("state")) && !"withdrawn".equals(entity.opt("state"))) throw error("REMOTE_WITHDRAWAL_RESURRECTION");
                if(record.optBoolean("businessRedacted")&&!"withdrawn".equals(entity.optString("state")))entity.put("data",new JSONObject());
                record.put("base",entity).put("localOnly",false);
            }
            if ("withdrawn".equals(record.getJSONObject("base").opt("state"))) {
                for (JSONObject item : objects(pendingFor(type,id))) {
                    deletePending(item.getString("operationId"));
                    putConflict(new JSONObject().put("operationId",item.getString("operationId")).put("status","withdrawn").put("conflictId",JSONObject.NULL));
                }
                purgeCommandsForWithdrawal(entity,commentOperation);
                // No legacy local-only copy or other record extension can retain withdrawn content.
                record = new JSONObject().put("entityType",type).put("entityId",id).put("localRevision",record.getLong("localRevision"))
                    .put("base",record.getJSONObject("base")).put("local",record.getJSONObject("base")).put("localOnly",false);
            }
            rebuild(record);
        }
        private void purgeCommandsForWithdrawal(JSONObject entity,String commentOperation) throws Exception {
            for (JSONObject job : objects(listPending("command"))) {
                String action = job.getString("action"); JSONObject input = job.getJSONObject("input"); boolean contains = false;
                if (action.equals("sendMessages") && entity.getString("entityType").equals("chatMessage")) {
                    for (JSONObject message : objects(input.getJSONArray("messages")))
                        if (productMessageId(input.getString("sourceId"),input.getString("roomId"),message.getString("id")).equals(entity.getString("entityId"))) contains = true;
                }
                if (action.equals("addComment") && entity.getString("entityType").equals("comment")) {
                    String operation=input.optString("operationId");
                    JSONObject mapping=getMapping("product-comment-operation",operation);
                    if (operation.equals(entity.getString("entityId")) || !commentOperation.isEmpty() && operation.equals(commentOperation)
                        || mapping != null && entity.getString("entityId").equals(mapping.opt("entityId"))) contains=true;
                }
                if (contains) {
                    // An immutable batch is never rewritten under the same ID. Other local content is
                    // preserved by localCommit's authority; caller may explicitly prepare a new batch.
                    deletePending(job.getString("operationId"));
                    putConflict(new JSONObject().put("operationId",job.getString("operationId")).put("status","withdrawn-command-cancelled").put("conflictId",JSONObject.NULL));
                }
            }
        }
        public void applyRemotePage(String mode,Object requestedCursor,JSONObject page,JSONObject expected) throws Exception {
            check(); guardIdentity(expected);
            if (!mode.equals("snapshot") && !mode.equals("pull")) throw error("INVALID_SYNC_MODE");
            JSONObject meta = getMeta(); String cursorField = mode.equals("snapshot") ? "snapshotCursor" : "cursor";
            Object current = meta.has(cursorField) ? meta.get(cursorField) : JSONObject.NULL;
            if (!same(current,requestedCursor == null ? JSONObject.NULL : requestedCursor)) throw error("STALE_RECEIVE_CURSOR");
            JSONArray entities = page.optJSONArray("entities");
            if (entities == null && page.optJSONArray("changes") != null) {
                entities = new JSONArray();
                for (JSONObject change : objects(page.getJSONArray("changes"))) entities.put(change.has("entity") ? change.get("entity") : change);
            }
            Object next = page.has("cursor") && !page.isNull("cursor") ? page.get("cursor") : page.opt("nextCursor");
            if (entities == null || entities.length() > 200 || !(page.opt("hasMore") instanceof Boolean) || !(next instanceof String)) throw error("INVALID_SYNC_PAGE");
            boolean more = page.getBoolean("hasMore");
            if (more && same(next,current)) throw error("NON_ADVANCING_SYNC_PAGE");
            if (mode.equals("pull") && !meta.optBoolean("initialized")) throw error("SNAPSHOT_REQUIRED");
            Set<String> seen = new HashSet<>();
            JSONArray prior = meta.optJSONArray("snapshotKeys"); if (prior != null) for (int n=0;n<prior.length();n++) seen.add(prior.getString(n));
            for (JSONObject entity : objects(entities)) {
                acceptEntity(entity);
                if (mode.equals("snapshot")) seen.add(key(entity.getString("entityType"),entity.getString("entityId")));
            }
            if (mode.equals("snapshot") && more) {
                meta.put("snapshotCursor",next); JSONArray keys = new JSONArray(); for (String entry : seen) keys.put(entry); meta.put("snapshotKeys",keys);
            } else {
                if (mode.equals("snapshot")) {
                    for (JSONObject record : objects(listEntities())) {
                        if (!seen.contains(key(record.getString("entityType"),record.getString("entityId"))) && !record.optBoolean("localOnly")
                            && !(record.optJSONObject("base") != null && "withdrawn".equals(record.getJSONObject("base").opt("state")))) {
                            record.put("base",JSONObject.NULL); rebuild(record);
                        }
                    }
                    meta.remove("snapshotCursor"); meta.remove("snapshotKeys"); meta.put("initialized",true);
                }
                Object checkpoint = mode.equals("snapshot") && page.has("checkpoint") && !page.isNull("checkpoint") ? page.get("checkpoint") : next;
                if (!(checkpoint instanceof String)) throw error("INVALID_SYNC_CHECKPOINT");
                meta.put("cursor",checkpoint);
                if(mode.equals("pull")&&!more)meta.remove("seedCatchUpRequired");
            }
            ProductDownloadQueue.track(meta,entities);
            setMeta(meta);
        }
        public void ackOperation(String operationId,JSONObject result,JSONObject expected) throws Exception {
            check(); guardIdentity(expected); if (!operationId.equals(result.opt("operationId"))) throw error("INVALID_PUSH_RESULT");
            String status = strictString(result,"status"); if (!Arrays.asList("accepted","conflict","rejected").contains(status)) throw error("INVALID_PUSH_RESULT");
            JSONObject item = getPending(operationId,"entity"); if (item == null) return; // idempotent late ACK
            if (item.optJSONObject("wire") == null) throw error("UNSENT_OPERATION_ACK");
            JSONObject intent = item.getJSONObject("intent"), entity = result.optJSONObject("entity");
            if (entity != null && (!intent.get("entityType").equals(entity.opt("entityType")) || !intent.get("entityId").equals(entity.opt("entityId")))) throw error("INVALID_ACK_ENTITY");
            if (status.equals("accepted")) {
                if (entity == null) throw error("MISSING_ACK_ENTITY");
                deletePending(operationId); acceptEntity(entity);
                if (result.optBoolean("conflict") || result.has("conflictId") && !result.isNull("conflictId"))
                    putConflict(new JSONObject().put("operationId",operationId).put("status","accepted-conflict").put("conflictId",result.opt("conflictId") == null ? JSONObject.NULL : result.get("conflictId")));
            } else {
                item.put("blocked",status); putPending(item,"entity");
                putConflict(new JSONObject().put("operationId",operationId).put("status",status).put("conflictId",result.opt("conflictId") == null ? JSONObject.NULL : result.get("conflictId")));
                if (entity != null) acceptEntity(entity);
            }
        }
        private JSONObject firstCommand() throws Exception { JSONArray jobs = listPending("command"); return jobs.length() == 0 ? null : jobs.getJSONObject(0); }
        public void ackCommand(String operationId,JSONObject receipt,JSONObject expected,Receipt apply) throws Exception {
            check(); guardIdentity(expected); JSONObject head = firstCommand();
            if (head == null) return;
            if (!operationId.equals(head.getString("operationId"))) throw error("PRODUCT_QUEUE_CHANGED");
            if (apply != null) apply.apply(this,copy(head),copy(receipt));
            guardIdentity(expected); deletePending(operationId);
        }
    }

    private static JSONObject blankRecord(String type,String id) throws Exception {
        return new JSONObject().put("entityType",type).put("entityId",id).put("localRevision",0).put("base",JSONObject.NULL).put("local",JSONObject.NULL).put("localOnly",false);
    }
    private static JSONObject applyIntent(JSONObject base,JSONObject intent) throws Exception {
        JSONObject current = base == null ? new JSONObject().put("entityType",intent.getString("entityType")).put("entityId",intent.getString("entityId"))
            .put("revision",0).put("state","active").put("data",new JSONObject()) : copy(base);
        String command = intent.getString("command");
        if (command.equals("create")) current.put("data",copy(intent.getJSONObject("data")));
        if (command.equals("updateFields")) {
            JSONObject data = current.getJSONObject("data"), changes = intent.getJSONObject("changes");
            for (Iterator<String> names=changes.keys();names.hasNext();) { String name=names.next(); data.put(name,cloneValue(changes.get(name))); }
        }
        if (command.equals("delete")) current.put("state","deleted");
        if (command.equals("withdraw")) current.put("state","withdrawn").put("data",new JSONObject());
        if (command.equals("restore")) current.put("state","active");
        return current;
    }
    private static void validateEnvelope(JSONObject value,boolean remote) throws Exception {
        if (value == null) throw error("INVALID_SERVER_ENTITY");
        strictString(value,"entityType"); strictString(value,"entityId");
        if (number(value,"revision",remote ? 1 : 0) < (remote ? 1 : 0) || !Arrays.asList("active","deleted","withdrawn").contains(value.opt("state"))) throw error("INVALID_SERVER_ENTITY");
        if (!"withdrawn".equals(value.opt("state")) && !(value.opt("data") instanceof JSONObject)) throw error("INVALID_SERVER_ENTITY");
        JSONObject data=value.optJSONObject("data");
        if (data != null) checkKnownDecimalFields(data);
    }
    private static JSONObject cleanEnvelope(JSONObject value) throws Exception {
        JSONObject clean=copy(value); if ("withdrawn".equals(clean.opt("state"))) clean.put("data",new JSONObject()); return clean;
    }
    private static boolean businessMatches(JSONObject base,JSONObject local) throws Exception {
        if(base==null||!base.optString("state").equals(local.optString("state")))return false;
        JSONObject actual=base.optJSONObject("data"),wanted=local.optJSONObject("data");
        if(actual==null||wanted==null)return same(actual,wanted);
        for(Iterator<String> keys=wanted.keys();keys.hasNext();) {
            String key=keys.next();if(Arrays.asList("_product","entryId","receivedAt","updatedAt","createdAt").contains(key))continue;
            if(!actual.has(key)||!same(actual.opt(key),wanted.opt(key)))return false;
        }
        return true;
    }
    private static void validatePreparedEntry(JSONObject data,String id) throws Exception {
        JSONObject meta=data.optJSONObject("_product"),body=data.optJSONObject("body");
        if(!id.equals(data.optString("id"))||meta==null||meta.optInt("schema")!=1||!"entry".equals(meta.optString("kind"))||data.has("chatJournal"))throw error("COMPLETE_PREPARED_ENTRY_REQUIRED");
        if(!"richdoc".equals(data.optString("contentFormat"))||body==null||!"shiye-richdoc".equals(body.optString("format"))||body.optInt("version")!=1||body.optJSONArray("content")==null)throw error("RICH_PREPARATION_REQUIRED");
        JSONObject authority=data.optJSONObject("messageUnits");
        if(authority!=null) {
            if(!"messageStore".equals(authority.optString("authority"))||authority.optInt("version")!=1)throw error("UNKNOWN_BODY_AUTHORITY");
            JSONObject canonical=data.optJSONObject("_canonical"),wrapper=canonical==null?null:canonical.optJSONObject("layout");
            JSONObject layout=wrapper==null?null:wrapper.optJSONObject("layout");JSONArray units=canonical==null?null:canonical.optJSONArray("units"),ids=authority.optJSONArray("ids");
            if(layout==null||!id.equals(layout.optString("entryId"))||units==null||ids==null)throw error("CANONICAL_PREPARATION_REQUIRED");
            Set<String> active=new HashSet<>();
            for(JSONObject unit:objects(units)) {
                JSONObject origin=unit.optJSONObject("origin");
                if(origin==null||!id.equals(origin.optString("entryId"))||!"diary".equals(origin.optString("kind")))throw error("CANONICAL_SOURCE_MISMATCH");
                if("active".equals(unit.optString("state"))&&unit.optJSONObject("body")!=null)active.add(strictString(unit,"id"));
            }
            if(active.size()!=ids.length())throw error("CANONICAL_ID_MISMATCH");
            for(int i=0;i<ids.length();i++)if(!(ids.opt(i) instanceof String)||!active.remove(ids.getString(i)))throw error("CANONICAL_ID_MISMATCH");
        }
    }
    private static void ensureEditable(String type,JSONObject data) throws Exception {
        if (data == null) throw error("COMPLETE_PRODUCT_RECORD_REQUIRED");
        JSONObject meta=data.optJSONObject("_product");
        if (meta == null || number(meta,"schema",1)!=1) throw error("OPAQUE_ENTITY_READ_ONLY");
        String kind=meta.optString("kind");
        if (!new HashSet<>(Arrays.asList("entry","conversation","taxonomy","order","appearance","profile","sticker","commandMapping","media")).contains(kind)) throw error("OPAQUE_ENTITY_READ_ONLY");
        if (kind.equals("entry") && data.has("chatJournal")) throw error("CHAT_PROJECTION_READ_ONLY");
        if (data.optJSONObject("messageUnits") != null && "messageStore".equals(data.getJSONObject("messageUnits").opt("authority"))) throw error("CANONICAL_PREPARATION_REQUIRED");
    }
    private static void checkKnownDecimalFields(JSONObject data) throws Exception {
        JSONObject product=data.optJSONObject("_product"); String kind=product == null ? "" : product.optString("kind");
        if (kind.equals("message") || kind.equals("conversation")) {
            decimal(data,"id",kind.equals("conversation"),false);
            if(kind.equals("message")&&data.has("replyTo"))decimal(data,"replyTo",false,false);
            JSONObject refs=product.optJSONObject("refs"), origin=refs == null ? null : refs.optJSONObject("origin");
            if (origin != null) { decimal(origin,"roomId",true,false); if (origin.has("messageId")) decimal(origin,"messageId",false,false); }
        }
    }
    private static void checkCommandIds(String action,JSONObject input) throws Exception {
        if (action.equals("sendMessages") || action.equals("withdrawMessage")) {
            strictString(input,"sourceId"); decimal(input,"roomId",true,false);
            if (action.equals("sendMessages")) {
                JSONArray messages=input.optJSONArray("messages"); if(messages==null || messages.length()>50) throw error("INVALID_MESSAGE_BATCH");
                for (JSONObject message:objects(messages)) { decimal(message,"id",false,false); if(message.has("replyTo"))decimal(message,"replyTo",false,false); }
            } else decimal(input,"messageId",false,false);
        }
    }
    private static void decimal(JSONObject value,String field,boolean negative,boolean optional) throws Exception {
        if(optional&&!value.has(field))return;
        Object v=value.opt(field); if(!(v instanceof String)||!((String)v).matches(negative?"-?[0-9]{1,20}":"[0-9]{1,20}"))throw error("MESSAGE_ID_MUST_BE_STRING");
    }
    public static String productMessageId(String sourceId,String roomId,String messageId) throws Exception {
        requireString(sourceId); requireString(roomId); requireString(messageId);
        return "chat:"+digest("["+quote(sourceId)+","+quote(roomId)+","+quote(messageId)+"]");
    }
    public static String productConversationId(String sourceId,String roomId) throws Exception {
        requireString(sourceId); requireString(roomId); return "room:"+digest("["+quote(sourceId)+","+quote(roomId)+"]");
    }
    private static String digest(String value) throws Exception {
        byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); StringBuilder out=new StringBuilder();
        for(byte b:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255)); return out.toString();
    }
    // JSONObject.quote escapes '/' on Android; JSON.stringify does not. Canonical product
    // coordinates are decimal/UUID, but match JS for all supported ASCII IDs as well.
    private static String quote(String value) { return JSONObject.quote(value).replace("\\/","/"); }
    private static JSONObject identity(JSONObject value) throws Exception {
        if(value==null)throw error("SERVER_IDENTITY_MISMATCH");
        return new JSONObject().put("libraryId",strictString(value,"libraryId")).put("epoch",strictString(value,"epoch"));
    }
    private static long nextRevision(long value) throws Exception { if(value>=MAX_SAFE_INTEGER)throw error("LOCAL_REVISION_OVERFLOW");return value+1; }
    private static long number(JSONObject value,String field,long minimum) throws Exception {
        Object v=value.opt(field); if(!(v instanceof Number))throw error("INVALID_INTEGER_FIELD");
        double d=((Number)v).doubleValue(); long l=((Number)v).longValue();
        if(!Double.isFinite(d)||d!=l||l<minimum||l>MAX_SAFE_INTEGER)throw error("INVALID_INTEGER_FIELD");return l;
    }
    private static String strictString(JSONObject value,String field) throws Exception {
        Object v=value.opt(field); if(!(v instanceof String)||((String)v).isEmpty())throw error("INVALID_STRING_FIELD");return(String)v;
    }
    private static void requireString(String value)throws Exception {if(value==null||value.isEmpty())throw error("INVALID_STRING_FIELD");}
    private static String operationId(){return "op-android-"+UUID.randomUUID();}
    private static String key(String type,String id)throws Exception{return new JSONArray().put(type).put(id).toString();}
    private static JSONObject copy(JSONObject value)throws Exception{return new JSONObject(value.toString());}
    private static Object cloneValue(Object value)throws Exception{
        if(value instanceof JSONObject)return copy((JSONObject)value);
        if(value instanceof JSONArray)return new JSONArray(value.toString()); return value;
    }
    private static List<JSONObject> objects(JSONArray values)throws Exception{
        List<JSONObject> result=new ArrayList<>();for(int i=0;i<values.length();i++){Object value=values.get(i);if(!(value instanceof JSONObject))throw error("INVALID_OBJECT_LIST");result.add((JSONObject)value);}return result;
    }
    private static boolean same(Object a,Object b)throws Exception{
        if(a==null||a==JSONObject.NULL)return b==null||b==JSONObject.NULL;
        if(b==null||b==JSONObject.NULL)return false;
        if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> i=x.keys();i.hasNext();){String k=i.next();if(!y.has(k)||!same(x.get(k),y.get(k)))return false;}return true;}
        if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!same(x.get(i),y.get(i)))return false;return true;}
        return a.equals(b);
    }
    private static RepositoryException error(String code){return new RepositoryException(code);}
}
