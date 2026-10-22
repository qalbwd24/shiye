package dev.shiye.app;

import android.content.SharedPreferences;
import android.os.Looper;
import android.webkit.WebMessagePort;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Future;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fixed native product controller. Local commits never depend on a successful network round trip. */
final class ProductUiBridge implements AutoCloseable {
    private final MainActivity h;
    private final ProductChatStore chat;
    private final ProductMediaBridge media;
    private final AndroidSyncTransport transport;
    private final BackendServices sharedServices;
    private final SharedBackendBridge sharedBridge;
    private final SharedSeedBridge sharedSeeds;
    private ProductSyncCoordinator runningCoordinator;
    private final ProductOriginals originals;
    private final SharedPreferences preferences;
    private final Object lock=new Object();
    private boolean closed;
    private final RunGate runs=new RunGate();
    private String lastError="";
    private JSONObject lastResult=new JSONObject();
    private Runnable changeListener;
    private final ScheduledExecutorService clock=Executors.newSingleThreadScheduledExecutor(r->new Thread(r,"shiye-sync-schedule"));
    private final ProductRetryPolicy retry=new ProductRetryPolicy();
    private ScheduledFuture<?> scheduled;
    private boolean foreground;
    private boolean automaticBlocked;
    private long nextAttempt;
    private String mediaError="";
    private boolean importingSeed;
    private long seedGeneration;

    /** Actual scheduling gate, also exercised without Android by the isolated concurrency probe. */
    static final class RunGate {
        private boolean busy,dirty;
        private long generation;
        private String phase="disabled";
        synchronized long request(){if(busy){dirty=true;return 0;}busy=true;dirty=false;phase="queued";return ++generation;}
        synchronized long requestAfter(long previous){return generation==previous?request():0;}
        synchronized boolean active(long token){return busy&&generation==token;}
        synchronized void phase(long token,String value){if(active(token))phase=value;}
        synchronized void idleIfStopped(String value){if(!busy)phase=value;}
        synchronized boolean finish(long token,boolean success,String value){
            if(!active(token))return false;
            boolean again=success&&dirty;busy=false;dirty=false;phase=value;return again;
        }
        synchronized void invalidate(String value){generation++;busy=false;dirty=false;phase=value;}
        synchronized boolean busy(){return busy;}
        synchronized String phase(){return phase;}
        static String resultPhase(boolean blocked,boolean more,long pending){return blocked?"blocked":more||pending>0?"checkpoint":"idle";}
    }

    ProductUiBridge(MainActivity host)throws Exception {
        h=host;chat=h.store.withProduct(ProductChatStore::new);media=new ProductMediaBridge(h,chat);
        transport=new AndroidSyncTransport(h);
        sharedServices=new BackendServices(h);sharedBridge=new SharedBackendBridge(sharedServices);
        sharedSeeds=new SharedSeedBridge(new File(h.getFilesDir(),"shared-seed-v1"));
        originals=new ProductOriginals(h,transport);preferences=h.getSharedPreferences("product-ui019",0);
        automaticBlocked=preferences.getBoolean("automaticBlocked021",false);
        runs.idleIfStopped(preferences.getBoolean("enabled",false)?automaticBlocked?"blocked":"idle":"disabled");
        // Remembered opt-in never initiates a request merely by constructing a page/controller.
    }
    ProductChatStore chat(){return chat;}
    ProductMediaBridge media(){return media;}
    /** New shared file lane: returns verified members; never invokes ProductSeedInstaller. */
    JSONObject prepareSharedSeed(java.io.InputStream input,String expectedSha256,SharedSeedFile.Cancellation cancel,SharedSeedFile.Progress progress)throws Exception{return sharedSeeds.prepare(input,expectedSha256,cancel,progress);}
    JSONObject prepareSharedSeedTicket(java.io.InputStream input,String expectedSha256,SharedSeedFile.Cancellation cancel,SharedSeedFile.Progress progress)throws Exception{return sharedSeeds.prepareTicket(input,expectedSha256,cancel,progress);}
    void setChangeListener(Runnable listener){synchronized(lock){changeListener=listener;}}
    void foreground(boolean value){synchronized(lock){foreground=value;if(!value)cancelSchedule();else if(!closed&&!automaticBlocked&&preferences.getBoolean("enabled",false)&&!runs.busy())schedule(250);}}
    void localCommitted(){synchronized(lock){if(closed||importingSeed||automaticBlocked||!preferences.getBoolean("enabled",false))return;}try{startSync();}catch(Exception ignored){/* Local save is already committed. */}}
    /** Native file-picker/backend entry. A WebView cannot supply paths or decoded seed entities. */
    Future<JSONObject> importPreparedSeed(ProductSeedFile.Prepared seed,ProductSeedFile.Progress progress)throws Exception{
        final long token;synchronized(lock){if(closed||importingSeed||runs.busy())throw new Exception("SYNC_MUST_STOP_FOR_SEED");cancelSchedule();importingSeed=true;token=++seedGeneration;}
        changed();
        try{return transport.executor().submit(()->{
            try{ProductSeedInstaller installer=new ProductSeedInstaller(h,h.store,transport,chat);
                JSONObject answer=installer.install(seed,()->{synchronized(lock){return closed||token!=seedGeneration;}},progress);
                synchronized(lock){lastError="";lastResult=new JSONObject().put("seedImport",answer);runs.idleIfStopped("checkpoint");}return answer;
            }catch(Exception failure){synchronized(lock){lastError=safeCode(failure);runs.idleIfStopped("blocked");}throw failure;}
            finally{synchronized(lock){importingSeed=false;if(!closed)schedule(250);}changed();}
        });}catch(RuntimeException failure){synchronized(lock){importingSeed=false;}throw failure;}
    }
    private void cancelSchedule(){if(scheduled!=null)scheduled.cancel(false);scheduled=null;nextAttempt=0;}
    private void schedule(long delay){
        cancelSchedule();if(closed||automaticBlocked||!foreground||!preferences.getBoolean("enabled",false)||delay<0)return;
        nextAttempt=System.currentTimeMillis()+delay;
        scheduled=clock.schedule(()->{synchronized(lock){scheduled=null;nextAttempt=0;if(closed||!foreground||!preferences.getBoolean("enabled",false))return;}try{startSync();}catch(Exception ignored){}},delay,TimeUnit.MILLISECONDS);
    }
    private void changed(){Runnable listener;synchronized(lock){listener=closed?null:changeListener;}if(listener!=null)h.main.post(listener);}
    private void active(long expected)throws Exception {synchronized(lock){if(closed||!runs.active(expected)||Thread.currentThread().isInterrupted())throw new Exception("PRODUCT_CANCELLED");}}
    JSONObject handle(String action,JSONObject payload,WebMessagePort owner)throws Exception {
        if(Looper.myLooper()==Looper.getMainLooper())throw new Exception("PRODUCT_MAIN_THREAD");
        synchronized(lock){if(closed)throw new Exception("PRODUCT_CLOSED");}
        JSONObject q=payload==null?new JSONObject():new JSONObject(payload.toString());
        if(SharedSeedBridge.supports(action))return sharedSeeds.handle(action,q);
        if(SharedBackendBridge.supports(action)) {
            try{return sharedBridge.handle(action,q);}
            catch(BackendServices.ServiceException failure){
                // Existing product-request serializer recognizes ChatException; preserve safe machine identity.
                throw new ProductChatStore.ChatException(failure.remoteCode.isEmpty()?"SHARED_"+failure.kind.name():failure.remoteCode);
            }
        }
        if(Arrays.asList("mediaImportStart","mediaImportChunk","mediaImportComplete","mediaImportCancel","chatMedia").contains(action))return media.handle(action,q,owner);
        switch(action){
            case "productSyncStatus":return status();
            // Explicit candidate data ports. Existing UI/default DiaryStore stays on its frozen lane.
            case "productPayloadCapabilities":return new ProductSyncCoordinator(h.store,transport).catalog();
            case "productPayloadEntryRead":{
                JSONObject capability=h.store.withProduct(r->r.metadata().optJSONObject("payloadWriteCatalogV1"));ProductPayloadWriter writer=new ProductPayloadWriter(h);
                return h.store.withProduct(r->ProductDiaryStore.supportsPayloadWrites(capability)?new ProductDiaryStore(r,writer,capability).read(q.getString("entryId")):new ProductDiaryStore(r).read(q.getString("entryId")));
            }
            case "productPayloadEntrySave":{
                JSONObject capability=h.store.withProduct(r->r.metadata().optJSONObject("payloadWriteCatalogV1"));ProductPayloadWriter writer=new ProductPayloadWriter(h);
                JSONObject saved=h.store.withProduct(r->new ProductDiaryStore(r,writer,capability).save(q.getJSONObject("preparedRecord"),q.getJSONArray("dirtyFields"),q.getLong("expectedLocalRevision")));
                localCommitted();changed();return saved;
            }
            case "productPayloadEntryQueueLocal":{
                JSONObject capability=h.store.withProduct(r->r.metadata().optJSONObject("payloadWriteCatalogV1"));ProductPayloadWriter writer=new ProductPayloadWriter(h);
                JSONObject queued=h.store.withProduct(r->new ProductDiaryStore(r,writer,capability).queueLocalOnly(q.getString("entryId"),q.getLong("expectedLocalRevision")));
                localCommitted();changed();return queued;
            }
            case "productSyncEnable":
                if(!preferences.edit().putBoolean("enabled",true).commit())throw new Exception("PRODUCT_SETTINGS_SAVE_FAILED");
                synchronized(lock){automaticBlocked=false;preferences.edit().putBoolean("automaticBlocked021",false).apply();retry.reset();runs.idleIfStopped("idle");}startSync();return status();
            case "productSyncDisable":
                if(!preferences.edit().putBoolean("enabled",false).commit())throw new Exception("PRODUCT_SETTINGS_SAVE_FAILED");
                synchronized(lock){cancelSchedule();seedGeneration++;runs.invalidate("disabled");if(runningCoordinator!=null)runningCoordinator.close();}transport.cancel();originals.cancel();changed();return status();
            case "productSyncRun":synchronized(lock){automaticBlocked=false;preferences.edit().putBoolean("automaticBlocked021",false).apply();retry.reset();}startSync();return status();
            case "productSyncQueueLocal":
                synchronized(lock){if(runs.busy())throw new Exception("SYNC_BUSY");}
                // An explicit user action opts preserved local Entries in; pairing alone never does.
                JSONObject selected=h.store.withProduct(r->ProductLocalSelection.queue(r,100));
                JSONObject deferred=h.store.withProduct(r->chat.queueOffline(new JSONObject().put("limit",100)));
                return status().put("selection",selected).put("offlineMessages",deferred);
            default:
                JSONObject answer=h.store.withProduct(r->chat.dispatch(action,q));
                // Import, draft changes and explicit offline promotion do NOT upload history.
                if((action.equals("chatSendText")||action.equals("chatWithdraw"))&&preferences.getBoolean("enabled",false))try{startSync();}catch(Exception ignored){/* Durable local ACK survives unavailable network scheduling. */}
                if(!action.equals("chatSnapshot")&&!action.equals("chatListRooms")&&!action.equals("chatOperation"))changed();
                return answer;
        }
    }
    JSONObject status()throws Exception {
        JSONObject result=h.store.withProduct(ProductRepository::status);
        JSONObject connection=transport.getStatus();
        synchronized(lock){return result.put("enabled",preferences.getBoolean("enabled",false)).put("running",runs.busy()||importingSeed)
            .put("phase",importingSeed?"importing-seed":runs.phase()).put("error",lastError).put("connection",connection).put("lastResult",new JSONObject(lastResult.toString()))
            .put("nextAttemptAt",nextAttempt).put("automaticScope","app-foreground").put("mediaError",mediaError)
            .put("contentSyncEnabled",preferences.getBoolean("enabled",false)&&result.optBoolean("initialized"))
            .put("legacyFullSeedEnabled",false).put("revisitUiComplete",false);}
    }
    private void startSync()throws Exception {
        startSync(0);
    }
    private void startSync(long predecessor)throws Exception {
        final long token;final ProductSyncCoordinator coordinator;
        synchronized(lock){if(closed)throw new Exception("PRODUCT_CLOSED");if(importingSeed)throw new Exception("SYNC_MUST_STOP_FOR_SEED");cancelSchedule();token=predecessor==0?runs.request():runs.requestAfter(predecessor);if(token==0)return;lastError="";coordinator=new ProductSyncCoordinator(h.store,transport);runningCoordinator=coordinator;}
        try {transport.executor().execute(()->{
            boolean success=false;String completedPhase="blocked";
            try {
                active(token);setPhase(token,"receiving");JSONObject received=coordinator.receive();active(token);
                JSONObject result=new JSONObject().put("receive",received);
                // A received Entry can refer to a server original not yet present locally.
                // Hydrate before preparing dependent local edits; download errors stay separate.
                try{downloadOriginals(token);}catch(Exception mediaFailure){synchronized(lock){if(runs.active(token))mediaError=safeCode(mediaFailure);}}
                active(token);
                completedPhase=received.optBoolean("hasMore")?"checkpoint":"idle";
                if(!received.optBoolean("hasMore")){
                    setPhase(token,"sending");JSONObject sent=coordinator.flushPrepared(job->requireDependencies(job,token),chat.receiptHandler());active(token);
                    if("PRODUCT_PAYLOAD_REBASE_REQUIRED".equals(sent.optString("errorCode")))synchronized(lock){if(runs.active(token)){lastError="PRODUCT_PAYLOAD_REBASE_REQUIRED";automaticBlocked=true;preferences.edit().putBoolean("automaticBlocked021",true).apply();}}
                    result.put("send",sent);setPhase(token,"receiving");JSONObject after=coordinator.receive();result.put("receiveAfterSend",after);active(token);
                    JSONObject local=h.store.withProduct(ProductRepository::status);active(token);
                    completedPhase=RunGate.resultPhase(sent.optBoolean("blocked"),after.optBoolean("hasMore"),local.optLong("pending"));
                }
                active(token);
                try{downloadOriginals(token);}catch(Exception mediaFailure){synchronized(lock){if(runs.active(token))mediaError=safeCode(mediaFailure);}}
                synchronized(lock){if(runs.active(token)&&!closed){lastResult=result;success=!completedPhase.equals("blocked");}}
            }catch(Exception error){completedPhase="blocked";synchronized(lock){if(runs.active(token)&&!closed)lastError=safeCode(error);}}
            finally{
                coordinator.close();boolean again;
                synchronized(lock){if(runningCoordinator==coordinator)runningCoordinator=null;boolean current=runs.active(token);again=!closed&&runs.finish(token,success,completedPhase);
                    if(current&&!again){long delay=success?retry.success(completedPhase.equals("checkpoint")):retry.failure(lastError);if(!success&&delay<0){automaticBlocked=true;preferences.edit().putBoolean("automaticBlocked021",true).apply();}schedule(delay);}}
                changed();if(again)try{startSync(token);}catch(Exception ignored){/* Queue failure is reported by startSync; never retry recursively. */}
            }
        });}catch(RuntimeException failure){synchronized(lock){if(runs.active(token)){runs.finish(token,false,"blocked");lastError="PRODUCT_QUEUE_UNAVAILABLE";}}throw new Exception("PRODUCT_QUEUE_UNAVAILABLE");}
    }
    private void setPhase(long token,String value)throws Exception{active(token);synchronized(lock){runs.phase(token,value);}changed();}
    private static String safeCode(Exception error){
        if(error instanceof AndroidSyncTransport.SyncException)return "SYNC_"+((AndroidSyncTransport.SyncException)error).kind.name();
        if(error instanceof ProductChatStore.ChatException)return ((ProductChatStore.ChatException)error).code;
        if(error instanceof ProductRepository.RepositoryException)return ((ProductRepository.RepositoryException)error).code;
        String code=error.getMessage();return code!=null&&code.matches("[A-Z][A-Z0-9_]{0,79}")?code:"PRODUCT_SYNC_FAILED";
    }
    private void downloadOriginals(long token)throws Exception{
        JSONObject identity=h.store.withProduct(ProductRepository::metadata).getJSONObject("identity");
        JSONArray assets=h.store.withProduct(ProductDownloadQueue::pending);
        int downloaded=0;
        for(int n=0;n<assets.length();n++){String id=assets.getString(n);active(token);try{media.file(id);h.store.withProduct(r->{ProductDownloadQueue.complete(r,id);return null;});continue;}catch(Exception missing){/* Verified download resumes its durable checkpoint. */}
            JSONObject spec=transport.mediaAsset(id);active(token);
            ProductOriginals.Spec input=new ProductOriginals.Spec(identity.getString("libraryId"),identity.getString("epoch"),id,spec.getLong("size"),spec.getString("sha256"),spec.getString("mime"));
            ProductOriginals.Status result=originals.download(input,()->{synchronized(lock){return closed||!runs.active(token);}},null);active(token);
            if(!result.ready)throw new Exception("MEDIA_DOWNLOAD_INCOMPLETE");media.registerDownloaded(spec,result.file);
            h.store.withProduct(r->{ProductDownloadQueue.complete(r,id);return null;});
            if(++downloaded>=4)break;
        }
        synchronized(lock){if(runs.active(token))mediaError="";}
    }
    private void requireDependencies(JSONObject job,long token)throws Exception {
        active(token);JSONObject input=job.optJSONObject("input");String action=job.optString("action");
        if(action.equals("sendMessages")||action.equals("withdrawMessage")){
            String source=input.getString("sourceId"),room=input.getString("roomId");
            JSONObject record=h.store.withProduct(r->r.load("conversation",ProductRepository.productConversationId(source,room)));
            if(record==null||record.optJSONObject("local")==null)throw new Exception("PRODUCT_ROOM_REQUIRED");
            if(record.optJSONObject("base")==null){
                JSONObject data=record.getJSONObject("local").getJSONObject("data");
                JSONObject fixed=new JSONObject().put("sourceId",source).put("id",room).put("title",data.optString("title","随想"));
                for(String field:new String[]{"category","idleHours","configuration"})if(data.has(field))fixed.put(field,data.get(field));
                active(token);transport.saveRoom(fixed);active(token);
            }
            JSONArray messages=input.optJSONArray("messages");if(messages!=null)for(int n=0;n<messages.length();n++)uploadAssets(messages.getJSONObject(n).optJSONArray("attachments"),token);
            return;
        }
        JSONObject wire=job.optJSONObject("wire");
        if(wire==null)throw new Exception("PRODUCT_UNSUPPORTED_DEPENDENCIES");
        if(job.optBoolean("payloadWrite")&&job.opt("payloadAssetId") instanceof String)uploadAssets(new JSONArray().put(job.getString("payloadAssetId")),token);
        String type=wire.optString("entityType");
        JSONObject record=h.store.withProduct(r->r.load(type,wire.getString("entityId")));
        JSONObject local=job.optJSONObject("preparedEntry")!=null?job.getJSONObject("preparedEntry"):record==null?null:record.optJSONObject("local"),data=local==null?null:local.optJSONObject("data");
        if(data==null)throw new Exception("PRODUCT_RECORD_REQUIRED");
        JSONObject meta=data.optJSONObject("_product"),refs=meta==null?null:meta.optJSONObject("refs");
        if(type.equals("relation")&&meta!=null&&"media".equals(meta.optString("kind"))&&refs!=null&&refs.opt("asset") instanceof String)uploadAssets(new JSONArray().put(refs.getString("asset")),token);
        if(refs!=null){
            Object category=refs.opt("category");if(category instanceof String){JSONObject taxonomy=h.store.withProduct(r->r.load("taxonomy",(String)category));if(taxonomy==null||taxonomy.optJSONObject("base")==null)throw new Exception("PRODUCT_TAXONOMY_DEPENDENCY_REQUIRED");}
            uploadAssets(refs.optJSONArray("assets"),token);
        }
        if(!Arrays.asList("taxonomy","relation","conversation","journalAggregate","profile").contains(type))throw new Exception("PRODUCT_UNSUPPORTED_DEPENDENCIES");
    }
    private void uploadAssets(JSONArray assets,long token)throws Exception{
        if(assets==null)return;
        for(int n=0;n<assets.length();n++){
            active(token);String id=assets.getString(n);JSONObject metadata=media.metadata(id);File file=media.file(id);
            if(!ProductMediaBridge.hash(file).equals(metadata.getString("sha256")))throw new Exception("MEDIA_HASH_MISMATCH");
            JSONObject fixed=new JSONObject();for(String field:new String[]{"assetId","size","sha256","mime","name"})fixed.put(field,metadata.get(field));
            JSONObject upload=transport.mediaBegin(fixed);active(token);
            if(!upload.optBoolean("available")){
                int chunk=upload.getInt("chunkSize");if(chunk<1||chunk>AndroidSyncTransport.MEDIA_CHUNK_LIMIT)throw new Exception("MEDIA_UNSUPPORTED_CHUNK_SIZE");
                String uploadId=upload.getString("uploadId");JSONArray missing=upload.getJSONArray("missingChunks");
                try(RandomAccessFile in=new RandomAccessFile(file,"r")){
                    for(int i=0;i<missing.length();i++){
                        active(token);int index=missing.getInt(i);long offset=(long)index*chunk;if(index<0||offset>=file.length())throw new Exception("MEDIA_INVALID_RANGE");
                        byte[] bytes=new byte[(int)Math.min(chunk,file.length()-offset)];in.seek(offset);in.readFully(bytes);
                        transport.mediaPutChunk(uploadId,index,bytes);active(token);
                    }
                }
                transport.mediaComplete(uploadId,id,file.length(),metadata.getString("sha256"));active(token);
            }
        }
    }
    void cancelOwner(WebMessagePort owner){media.cancelOwner(owner);}
    @Override public void close(){synchronized(lock){if(closed)return;closed=true;seedGeneration++;cancelSchedule();runs.invalidate("closed");changeListener=null;if(runningCoordinator!=null)runningCoordinator.close();}clock.shutdownNow();originals.cancel();transport.close();media.close();sharedSeeds.close();}
}
