package dev.shiye.app;

import org.json.JSONArray;
import org.json.JSONObject;

/** Fixed product/sync calls around short repository transactions, never network in SQLite. */
public final class ProductSyncCoordinator implements AutoCloseable {
    public interface Dependencies { void requireReady(JSONObject immutableJob) throws Exception; }
    private final LocalStore store;
    private final AndroidSyncTransport transport;
    private volatile boolean closed;

    public ProductSyncCoordinator(LocalStore store, AndroidSyncTransport transport) {
        this.store=store;this.transport=transport;
    }
    private void active() throws Exception {
        if(closed||Thread.currentThread().isInterrupted())throw new Exception("PRODUCT_CANCELLED");
    }
    private JSONObject identity() throws Exception {
        active();JSONObject info=transport.connect();JSONObject catalog=transport.catalog();active();
        if(catalog.optInt("schema")!=1||!info.optString("libraryId").equals(catalog.optString("libraryId"))
            ||!info.optString("epoch").equals(catalog.optString("epoch")))throw new Exception("PRODUCT_IDENTITY_MISMATCH");
        store.withProduct(r->{active();r.bindIdentity(info);r.transaction(tx->{JSONObject meta=tx.getMeta();if(ProductDiaryStore.supportsPayloadWrites(catalog))meta.put("payloadWriteCatalogV1",new JSONObject().put("payloadWrites",new JSONObject(catalog.getJSONObject("payloadWrites").toString())));else meta.remove("payloadWriteCatalogV1");tx.setMeta(meta);return null;});return null;});return info;
    }
    public JSONObject status() throws Exception { return store.withProduct(ProductRepository::status); }
    public JSONObject catalog() throws Exception { identity();return transport.catalog(); }

    /** Explicit receive only. No legacy data upload, projection overwrite or auto-created intent. */
    public JSONObject receive() throws Exception {
        JSONObject id=identity();int pages=0,received=0,limit=25;
        boolean more;
        do {
            active();JSONObject meta=store.withProduct(ProductRepository::metadata);
            String mode=meta.optBoolean("initialized")?"pull":"snapshot";
            String key=mode.equals("snapshot")?"snapshotCursor":"cursor";
            String cursor=meta.has(key)&&!meta.isNull(key)?meta.getString(key):null;
            JSONObject page;
            while(true) {
                try {page=mode.equals("snapshot")?transport.snapshot(cursor,limit):transport.pull(cursor,limit);break;}
                catch(AndroidSyncTransport.SyncException failure) {
                    if(failure.kind!=AndroidSyncTransport.Failure.TOO_LARGE||limit<=1)throw failure;
                    limit=Math.max(1,limit/2);active(); // No page or cursor was committed.
                }
            }
            final JSONObject receivedPage=page;
            active();store.withProduct(r->{active();r.applyRemotePage(mode,cursor,receivedPage,id);return null;});
            JSONArray rows=page.optJSONArray("entities");if(rows==null)rows=page.optJSONArray("changes");
            received+=rows==null?0:rows.length();pages++;more=page.getBoolean("hasMore");
            if(pages>=100&&more)break; // Yield with committed checkpoint; another explicit run resumes.
        } while(more);
        return status().put("received",received).put("pages",pages).put("hasMore",more)
            .put("legacyContentSyncEnabled",false);
    }

    /** For controllers already using the repository as their sole local authority. */
    public JSONObject flushPrepared(Dependencies dependencies,ProductRepository.Receipt commandReceipt) throws Exception {
        JSONObject id=identity();int count=0;
        while(count<100) {
            active();JSONObject job=store.withProduct(r->r.prepareNextPush(id));if(job==null)break;
            if(job.optBoolean("payloadWrite")&&!ProductDiaryStore.supportsPayloadWrites(transport.catalog()))throw new Exception("PRODUCT_PAYLOAD_WRITES_UNSUPPORTED");
            if(dependencies==null)throw new Exception("PRODUCT_DEPENDENCIES_REQUIRED");
            dependencies.requireReady(new JSONObject(job.toString()));active();
            JSONObject wire=job.getJSONObject("wire");
            JSONObject answer;
            try{answer=transport.push(new JSONArray().put(wire));}
            catch(AndroidSyncTransport.SyncException failure){if(failure.httpStatus==409&&"PRODUCT_PAYLOAD_REBASE_REQUIRED".equals(failure.remoteCode)){store.withProduct(r->{r.blockPayloadOperation(wire.getString("operationId"));return null;});return status().put("acknowledged",count).put("blocked",true).put("errorCode","PRODUCT_PAYLOAD_REBASE_REQUIRED");}throw failure;}
            active();JSONArray results=answer.optJSONArray("results");
            if(results==null||results.length()!=1||!wire.getString("operationId").equals(results.getJSONObject(0).optString("operationId")))
                throw new Exception("PRODUCT_INVALID_ACK");
            JSONObject result=results.getJSONObject(0);
            store.withProduct(r->{active();r.ackOperation(wire.getString("operationId"),result,id);return null;});count++;
            if(!"accepted".equals(result.optString("status")))return status().put("acknowledged",count).put("blocked",true);
        }
        while(count<100) {
            active();JSONObject job=store.withProduct(r->r.nextCommand(id));if(job==null)break;
            // Media/business metadata, taxonomy and room identities must already be accepted.
            if(dependencies==null||commandReceipt==null)throw new Exception("PRODUCT_DEPENDENCIES_AND_RECEIPT_REQUIRED");
            dependencies.requireReady(new JSONObject(job.toString()));active();
            String action=job.getString("action");JSONObject input=job.getJSONObject("input"),receipt;
            switch(action) {
                case "sendMessages":receipt=transport.sendMessages(input);break;
                case "withdrawMessage":receipt=transport.withdrawMessage(input);break;
                case "addComment":receipt=transport.addComment(input);break;
                case "withdrawComment":receipt=transport.withdrawComment(input);break;
                default:throw new Exception("PRODUCT_INVALID_COMMAND");
            }
            active();store.withProduct(r->{active();r.ackCommand(job.getString("operationId"),receipt,id,commandReceipt);return null;});count++;
        }
        JSONArray pending=store.withProduct(ProductRepository::pending);for(int n=0;n<pending.length();n++)if("PRODUCT_PAYLOAD_REBASE_REQUIRED".equals(pending.getJSONObject(n).optString("blocked")))return status().put("acknowledged",count).put("blocked",true).put("errorCode","PRODUCT_PAYLOAD_REBASE_REQUIRED");
        return status().put("acknowledged",count);
    }
    public JSONObject revisitStatus() throws Exception {identity();return transport.revisitStatus();}
    public JSONObject revisitFeed(Object after,int limit) throws Exception {
        identity();return transport.revisitFeed(new JSONObject().put("after",after==null?0:after).put("limit",limit));
    }
    public JSONObject revisitSource(String deliveryId) throws Exception {
        identity();return transport.revisitSource(new JSONObject().put("deliveryId",deliveryId));
    }
    public JSONObject configureRevisit(JSONObject immutableDraft) throws Exception {
        identity();return transport.configureRevisit(new JSONObject(immutableDraft.toString()));
    }
    @Override public void close(){closed=true;transport.cancel();}
}
