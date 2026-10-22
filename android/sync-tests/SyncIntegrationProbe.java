package dev.shiye.app;

import android.app.Instrumentation;
import android.os.Bundle;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Actual Android SQLite/Keystore/HTTP/file tests. Only this test package's invented data. */
public final class SyncIntegrationProbe extends Instrumentation {
    private final JSONArray checks=new JSONArray();
    private void check(String name,boolean value)throws Exception{if(!value)throw new Exception(name);checks.put(name);}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){JSONObject result=new JSONObject();MainActivity h=null;ProductUiBridge bridge=null;AndroidSyncTransport transport=null;
        try{
            JSONObject fixture=read("fixture.json");h=new MainActivity(getTargetContext(),"run"+System.nanoTime());
            final MainActivity host=h;ProductRepository repo=h.store.repo;
            JSONObject prepared=fixture.getJSONObject("entry");String id=prepared.getString("entityId");
            ProductDiaryStore diaries=new ProductDiaryStore(repo);
            diaries.save(prepared,new JSONArray().put("title").put("body"),0);
            check("offline-entry-committed-no-network",repo.pending().length()==0&&repo.load("journalAggregate",id).getBoolean("localOnly"));
            bridge=new ProductUiBridge(h);transport=new AndroidSyncTransport(h);
            transport.saveBaseUrl("http://127.0.0.1:19421");transport.pair(fixture.getString("pairCode"),"isolated-native021");
            ProductSyncCoordinator coordinator=new ProductSyncCoordinator(h.store,transport);JSONObject received=coordinator.receive();
            check("actual-http-initial-snapshot",received.getBoolean("initialized")&&!received.getBoolean("hasMore"));
            check("pair-and-receive-do-not-upload-local",repo.pending().length()==0&&repo.load("journalAggregate",id).getBoolean("localOnly"));
            check("remote-full-entry-available",repo.load("journalAggregate",fixture.getString("remoteEntryId"))!=null);
            check("inbox-original-task-persisted",ProductDownloadQueue.pending(repo).length()>0);
            JSONObject selected=ProductLocalSelection.queue(repo,100);
            check("explicit-local-selection",selected.getInt("queuedEntries")==1&&repo.pending().length()==2);
            check("selection-idempotent",ProductLocalSelection.queue(repo,100).getInt("queuedEntries")==0&&repo.pending().length()==2);
            android.database.sqlite.SQLiteDatabase second=android.database.sqlite.SQLiteDatabase.openDatabase(h.store.db.getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
            try{check("outbox-commit-visible-to-reopened-connection",new ProductRepository(second).pending().length()==2);}finally{second.close();}
            MainActivity isolated=new MainActivity(getTargetContext(),"rollback"+System.nanoTime());
            try{
                ProductRepository rollback=isolated.store.repo;JSONObject identity=repo.metadata().getJSONObject("identity");
                JSONArray originals=repo.records();rollback.transaction(tx->{JSONObject m=tx.getMeta();m.put("initialized",true);tx.setMeta(m);for(int n=0;n<originals.length();n++){JSONObject row=originals.getJSONObject(n);if(!row.getString("entityId").equals(id)&&row.optJSONObject("base")!=null)tx.acceptEntity(row.getJSONObject("base"));}return null;});
                JSONObject invalid=new JSONObject(prepared.toString());invalid.getJSONObject("data").getJSONObject("_product").getJSONObject("refs").put("assets",new JSONArray().put("missing-original021"));
                new ProductDiaryStore(rollback).save(invalid,new JSONArray().put("title").put("body"),0);rollback.bindIdentity(new JSONObject(identity.toString()).put("protocol",1));
                boolean rejected=false;try{ProductLocalSelection.queue(rollback,100);}catch(Exception expected){rejected=true;}
                check("dependency-failure-rolls-back-entire-selection",rejected&&rollback.pending().length()==0&&rollback.load("taxonomy","taxonomy:local021")==null&&rollback.load("journalAggregate",id).getBoolean("localOnly"));
            }finally{isolated.store.db.close();}
            bridge.handle("productSyncRun",new JSONObject(),null);JSONObject status=waitFor(bridge);
            result.put("syncPhase",status.optString("phase")).put("syncError",status.optString("error")).put("pending",status.optLong("pending"));check("real-http-outbox-drained",status.getLong("pending")==0&&status.getString("phase").equals("idle"));
            check("unknown-entry-field-retained",repo.load("journalAggregate",id).getJSONObject("local").getJSONObject("data").getJSONObject("futureExtension").getString("preserve").equals("sync021"));
            File original=bridge.media().file(fixture.getJSONObject("original").getString("assetId"));
            check("original-downloaded-sha-verified",ProductMediaBridge.hash(original).equals(fixture.getJSONObject("original").getString("sha256")));
            check("original-download-task-cleared",ProductDownloadQueue.pending(repo).length()==0);
            Thread.sleep(400);bridge.handle("productSyncRun",new JSONObject(),null);waitFor(bridge);
            check("pc-change-pulled-to-same-local-entry",repo.load("journalAggregate",id).getJSONObject("local").getJSONObject("data").getString("title").equals("电脑合成修改021"));
            // Authentication failure suspends automatic retries and survives a controller restart.
            String key=SyncCredentials.key(transport.getBaseUrl());android.content.SharedPreferences prefs=h.getSharedPreferences("sync_connection_v1",0);String credential=prefs.getString(key,"");prefs.edit().remove(key).commit();
            bridge.foreground(true);bridge.handle("productSyncEnable",new JSONObject(),null);status=waitFor(bridge);
            check("auth-failure-pauses-auto-retry",status.getString("error").equals("SYNC_AUTH_REQUIRED")&&status.getLong("nextAttemptAt")==0);
            bridge.close();bridge=new ProductUiBridge(h);bridge.foreground(true);Thread.sleep(400);
            check("auth-pause-survives-recreation",bridge.status().getString("phase").equals("blocked")&&!bridge.status().getBoolean("running"));
            prefs.edit().putString(key,credential).commit();bridge.handle("productSyncRun",new JSONObject(),null);waitFor(bridge);
            // A real socket refusal yields a bounded retry; pausing cancels that retry.
            String oldBase=transport.getBaseUrl(),newBase="http://127.0.0.1:19422";SyncCredentials crypto=new SyncCredentials();prefs.edit().putString(SyncCredentials.key(newBase),crypto.encrypt(newBase,crypto.decrypt(oldBase,credential))).commit();transport.saveBaseUrl(newBase);bridge.handle("productSyncRun",new JSONObject(),null);status=waitFor(bridge);
            check("network-failure-retains-data-and-backs-off",status.getString("error").equals("SYNC_NETWORK")&&status.getLong("nextAttemptAt")>System.currentTimeMillis()&&repo.load("journalAggregate",id)!=null);
            bridge.handle("productSyncDisable",new JSONObject(),null);
            check("pause-cancels-next-attempt",bridge.status().getLong("nextAttemptAt")==0&&!bridge.status().getBoolean("enabled"));
            transport.saveBaseUrl("http://127.0.0.1:19421");
            ProductRetryPolicy policy=new ProductRetryPolicy();long delay=0;for(int i=0;i<12;i++)delay=policy.failure("SYNC_NETWORK");
            check("retry-cap-and-terminal-errors",delay==300000&&policy.failure("SYNC_LIBRARY_MISMATCH")==-1&&policy.failure("SYNC_AUTH_REQUIRED")==-1);
            check("checkpoint-yields-after-three-rounds",policy.success(true)==250&&policy.success(true)==250&&policy.success(true)==250&&policy.success(true)==5000);
            result.put("ok",true).put("actualAndroid",true).put("synthetic",true).put("checks",checks).put("scope","Production repository, diary selection, bridge, transport, originals; Context/LocalStore wrappers own an isolated SQLite database. No user application data accessed.");
        }catch(Throwable failure){try{result.put("ok",false).put("checks",checks).put("failure",failure.toString());}catch(Exception ignored){}}
        finally{if(bridge!=null)bridge.close();if(transport!=null)transport.close();if(h!=null)h.store.db.close();}
        try{try(FileOutputStream file=new FileOutputStream(new File(getTargetContext().getFilesDir(),"result.json"))){file.write(result.toString(2).getBytes(StandardCharsets.UTF_8));}}catch(Exception ignored){}
        Bundle done=new Bundle();done.putString("result",result.toString());finish(result.optBoolean("ok")?-1:0,done);
    }
    private JSONObject waitFor(ProductUiBridge bridge)throws Exception{long deadline=System.currentTimeMillis()+45000;JSONObject value;
        do{Thread.sleep(80);value=bridge.status();if(!value.getBoolean("running"))return value;}while(System.currentTimeMillis()<deadline);throw new Exception("SYNC_DEADLINE");}
    private JSONObject read(String name)throws Exception{try(InputStream in=getTargetContext().getAssets().open(name);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1)bytes.write(block,0,n);return new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}}
}
