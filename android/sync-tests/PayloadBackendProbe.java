package dev.shiye.app;

import android.app.Instrumentation;
import android.os.Bundle;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Isolated native writer/reader transaction checks. No service, production UID or UI. */
public final class PayloadBackendProbe extends Instrumentation {
    private final JSONArray checks=new JSONArray();
    private boolean http;
    private interface Work{void run()throws Exception;}
    private void check(String name,boolean ok)throws Exception{if(!ok)throw new Exception(name);checks.put(name);}
    private void rejects(String name,Work work)throws Exception{boolean failed=false;try{work.run();}catch(Exception expected){failed=true;}check(name,failed);}
    @Override public void onCreate(Bundle args){super.onCreate(args);http=args!=null&&"true".equals(args.getString("http"));start();}
    @Override public void onStart(){JSONObject result=new JSONObject();MainActivity host=null;ProductSeedFile.Prepared seed=null;
        try{
            host=new MainActivity(getTargetContext(),"payload"+System.nanoTime());final ProductRepository repo=host.store.repo;
            JSONObject fixture;try(InputStream in=getTargetContext().getAssets().open("seed-golden.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[8192];int n;while((n=in.read(block))!=-1)out.write(block,0,n);fixture=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}
            byte[] bytes=android.util.Base64.decode(fixture.getString("packageBase64"),android.util.Base64.DEFAULT);
            seed=ProductSeedFile.prepare(new ByteArrayInputStream(bytes),new File(host.getNoBackupFilesDir(),"source"),fixture.getString("sha256"),null,null);
            final JSONObject[] entry={null};seed.forEach(row->{JSONObject d=row.optJSONObject("data");if("journalAggregate".equals(row.optString("entityType"))&&d!=null&&d.optJSONObject("_canonical")!=null&&!d.has("chatJournal"))entry[0]=new JSONObject(row.toString());});
            if(entry[0]==null)throw new Exception("canonical-fixture-required");
            ProductPayloadWriter writer=new ProductPayloadWriter(host);
            ProductPayloadWriter.Prepared small=writer.prepare(entry[0]);check("small-entry-remains-inline",small.original()==null);
            char[] padding=new char[900000];Arrays.fill(padding,'x');entry[0].getJSONObject("data").put("futureWriterField",new String(padding));String before=entry[0].toString();
            ProductPayloadWriter.Prepared packed=writer.prepare(entry[0]);JSONObject mapping=packed.original(),wireRecord=packed.record();
            check("caller-full-entry-stays-unchanged",before.equals(entry[0].toString()));
            check("large-entry-packs-known-content-id",mapping!=null&&mapping.getString("assetId").equals("payload-"+mapping.getString("sha256"))&&wireRecord.getJSONObject("data").length()==1);
            check("writer-does-not-publish-db-before-transaction",repo.records().length()==0&&repo.pending().length()==0);
            rejects("mapping-index-rollback",()->repo.transaction(tx->{tx.putMapping("product-original019",mapping.getString("assetId"),mapping);throw new IOException("injected");}));
            check("failed-index-has-no-published-mapping",repo.transaction(tx->tx.getMapping("product-original019",mapping.getString("assetId")))==null);
            final ProductSeedFile.Prepared verifiedSeed=seed;
            repo.transaction(tx->{verifiedSeed.forEach(tx::acceptEntity);tx.putMapping("product-original019",mapping.getString("assetId"),mapping);tx.acceptEntity(wireRecord);return null;});
            JSONObject hydrated=ProductPayloadReader.hydrate(repo,wireRecord);
            check("full-unknown-fields-round-trip",hydrated.getJSONObject("data").getString("futureWriterField").equals(new String(padding)));
            check("wire-base-remains-pointer-after-read",ProductPayloadReader.packed(repo.load(wireRecord.getString("entityType"),wireRecord.getString("entityId")).getJSONObject("base")));
            JSONObject repeat=writer.prepare(entry[0]).original();check("same-value-reuses-verified-original",mapping.toString().equals(repeat.toString()));
            JSONObject identity=new JSONObject().put("protocol",1).put("libraryId",seed.manifest().getString("libraryId")).put("epoch",seed.manifest().getString("epoch"));repo.bindIdentity(identity);
            JSONObject capability=new JSONObject().put("payloadWrites",new JSONObject().put("version",1).put("conflict","strict-base-revision").put("maxBytes",67108864));
            rejects("old-service-does-not-enable-payload-writes",()->new ProductDiaryStore(repo,writer,new JSONObject()));
            ProductDiaryStore diary=new ProductDiaryStore(repo,writer,capability);String entryId=wireRecord.getString("entityId");
            check("default-constructor-stays-read-only",new ProductDiaryStore(repo).read(entryId).getBoolean("payloadReadOnly"));
            JSONObject current=diary.read(entryId),edited=new JSONObject(current.getJSONObject("local").toString());edited.getJSONObject("data").put("title","offline payload edit 1");
            JSONObject saved=diary.save(edited,new JSONArray().put("title"),current.getLong("localRevision"));String firstOperation=saved.getString("operationId");JSONObject firstJob=repo.pending().getJSONObject(0),frozen=new JSONObject(firstJob.getJSONObject("wire").toString());
            check("offline-edited-body-and-unknown-field-preserved",diary.read(entryId).getJSONObject("local").getJSONObject("data").getString("futureWriterField").equals(new String(padding)));
            check("payload-intent-is-small-verified-snapshot-pointer",firstJob.optBoolean("payloadWrite")&&firstJob.toString().length()<30000&&firstJob.has("payloadAssetId")&&ProductPayloadReader.packed(firstJob.getJSONObject("preparedEntry")));
            current=diary.read(entryId);JSONObject second=new JSONObject(current.getJSONObject("local").toString());second.getJSONObject("data").put("title","offline payload edit 2");diary.save(second,new JSONArray().put("title"),current.getLong("localRevision"));
            check("rapid-edits-use-fixed-sequential-cas-revisions",repo.pending().getJSONObject(1).getJSONObject("wire").getLong("baseRevision")==frozen.getLong("baseRevision")+1);
            JSONObject remote=new JSONObject(wireRecord.toString()).put("revision",wireRecord.getLong("revision")+1);repo.transaction(tx->{tx.acceptEntity(remote);return null;});
            check("remote-pull-does-not-rewrite-fixed-wire",repo.pending().getJSONObject(0).getJSONObject("wire").toString().equals(frozen.toString()));
            check("remote-pull-preserves-full-local-overlay",diary.read(entryId).getJSONObject("local").getJSONObject("data").getString("title").equals("offline payload edit 2"));
            final JSONObject expectedBase=repo.load("journalAggregate",entryId).getJSONObject("base");final JSONObject finalPrepared=new JSONObject(second.toString());ProductPayloadWriter.Prepared failedCandidate=writer.prepare(finalPrepared);final JSONObject failedWire=failedCandidate.record().getJSONObject("data"),failedOriginal=failedCandidate.original();final long localRevision=repo.load("journalAggregate",entryId).getLong("localRevision");int pendingCount=repo.pending().length();
            rejects("payload-outbox-and-local-revision-roll-back",()->repo.enqueuePayloadEntry(finalPrepared,new JSONArray().put("title"),failedWire,failedOriginal,expectedBase,localRevision,(tx,job)->{throw new IOException("injected");}));
            check("failed-payload-save-keeps-old-intents",repo.pending().length()==pendingCount&&repo.load("journalAggregate",entryId).getLong("localRevision")==localRevision);
            repo.blockPayloadOperation(firstOperation);check("cas-conflict-blocks-without-changing-operation",repo.prepareNextPush(identity)==null&&repo.pending().getJSONObject(0).getString("operationId").equals(firstOperation)&&repo.pending().getJSONObject(0).getJSONObject("wire").toString().equals(frozen.toString()));
            android.database.sqlite.SQLiteDatabase reopened=android.database.sqlite.SQLiteDatabase.openDatabase(host.getDatabasePath("synthetic021.db").getAbsolutePath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
            try{ProductRepository restored=new ProductRepository(reopened);check("immutable-wire-and-full-overlay-survive-reopen",restored.pending().getJSONObject(0).getJSONObject("wire").toString().equals(frozen.toString())&&new ProductDiaryStore(restored,writer,capability).read(entryId).getJSONObject("local").getJSONObject("data").getString("title").equals("offline payload edit 2"));}finally{reopened.close();}
            File original=new File(mapping.getString("path"));try(RandomAccessFile out=new RandomAccessFile(original,"rw")){out.seek(0);out.write('!');}
            rejects("existing-original-corruption-refused",()->writer.prepare(entry[0]));
            if(http)httpRoundTrip();
            result.put("ok",true).put("synthetic",true).put("checks",checks).put("networkTested",http).put("frontendUntouched",true);
        }catch(Throwable failure){try{result.put("ok",false).put("failure",failure.toString()).put("checks",checks);}catch(Exception ignored){}}
        finally{if(seed!=null)try{seed.close();}catch(Exception ignored){}if(host!=null)host.store.db.close();}
        try(FileOutputStream out=new FileOutputStream(new File(getTargetContext().getFilesDir(),"payload-result.json"))){out.write(result.toString(2).getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}
        Bundle answer=new Bundle();answer.putString("result",result.toString());finish(result.optBoolean("ok")?-1:0,answer);
    }
    private void httpRoundTrip()throws Exception{
        MainActivity primary=null,peer=null;AndroidSyncTransport firstTransport=null,peerTransport=null;ProductUiBridge firstBridge=null,peerBridge=null;
        try{
            JSONObject fixture=asset("fixture.json");primary=new MainActivity(getTargetContext(),"payload-http-first-"+System.nanoTime());
            firstTransport=new AndroidSyncTransport(primary);firstTransport.saveBaseUrl("http://127.0.0.1:19421");firstTransport.pair(fixture.getString("pairCode"),"payload-first");
            new ProductSyncCoordinator(primary.store,firstTransport).receive();firstBridge=new ProductUiBridge(primary);
            JSONObject input=new JSONObject(fixture.getJSONObject("payloadEntry").toString());String id=input.getString("entityId");
            firstBridge.handle("productPayloadEntrySave",new JSONObject().put("preparedRecord",input).put("dirtyFields",new JSONArray().put("body")).put("expectedLocalRevision",0),null);
            JSONObject frozen=new JSONObject(primary.store.repo.pending().getJSONObject(0).getJSONObject("wire").toString());String operation=frozen.getString("operationId");
            check("http-create-queued-offline-as-payload",frozen.getJSONObject("data").getJSONObject("_product").has("payload"));
            JSONObject sent=run(firstBridge);check("java-save-upload-http-ack-clears-outbox",primary.store.repo.pending().length()==0&&sent.getString("error").isEmpty());
            JSONObject committed=primary.store.repo.load("journalAggregate",id).getJSONObject("base");
            JSONObject replay=firstTransport.push(new JSONArray().put(frozen)).getJSONArray("results").getJSONObject(0);
            check("http-identical-operation-replays-original-ack",replay.getString("operationId").equals(operation)&&replay.getString("status").equals("accepted")&&replay.getJSONObject("entity").getLong("revision")==committed.getLong("revision"));
            peer=new MainActivity(getTargetContext(),"payload-http-peer-"+System.nanoTime());peerTransport=new AndroidSyncTransport(peer);peerTransport.saveBaseUrl("http://127.0.0.1:19421");peerTransport.pair(fixture.getString("pairCode"),"payload-peer");peerBridge=new ProductUiBridge(peer);run(peerBridge);
            JSONObject peerRead=new ProductDiaryStore(peer.store.repo).read(id);
            check("other-repository-receives-and-hydrates-full-payload",peerRead.getJSONObject("local").getJSONObject("data").getJSONObject("futurePayloadInvariant").getString("unknownField").equals("preserved")&&peerRead.getJSONObject("local").getJSONObject("data").getJSONObject("body").toString().length()>786432);
            ProductDiaryStore firstDiary=new ProductDiaryStore(primary.store.repo,new ProductPayloadWriter(primary),firstTransport.catalog());JSONObject local=firstDiary.read(id),localEdit=new JSONObject(local.getJSONObject("local").toString());localEdit.getJSONObject("data").put("title","pending local before remote");
            firstBridge.handle("productPayloadEntrySave",new JSONObject().put("preparedRecord",localEdit).put("dirtyFields",new JSONArray().put("title")).put("expectedLocalRevision",local.getLong("localRevision")),null);
            JSONObject pendingBefore=new JSONObject(primary.store.repo.pending().getJSONObject(0).toString()),wireBefore=new JSONObject(pendingBefore.getJSONObject("wire").toString());
            JSONObject peerEdit=new JSONObject(peerRead.getJSONObject("local").toString());peerEdit.getJSONObject("data").put("title","concurrent remote wins first");
            peerBridge.handle("productPayloadEntrySave",new JSONObject().put("preparedRecord",peerEdit).put("dirtyFields",new JSONArray().put("title")).put("expectedLocalRevision",peerRead.getLong("localRevision")),null);run(peerBridge);
            check("remote-payload-edit-commits-before-stale-local",peer.store.repo.pending().length()==0);
            JSONObject blocked=run(firstBridge),pendingAfter=primary.store.repo.pending().getJSONObject(0);
            check("real-http409-blocks-stale-local-cas","PRODUCT_PAYLOAD_REBASE_REQUIRED".equals(blocked.optString("error"))&&"PRODUCT_PAYLOAD_REBASE_REQUIRED".equals(pendingAfter.optString("blocked")));
            check("http409-keeps-original-operation-and-wire",pendingAfter.getString("operationId").equals(pendingBefore.getString("operationId"))&&pendingAfter.getJSONObject("wire").toString().equals(wireBefore.toString()));
            check("http409-keeps-complete-local-value-and-original",firstDiary.read(id).getJSONObject("local").getJSONObject("data").getString("title").equals("pending local before remote")&&firstDiary.read(id).getJSONObject("local").getJSONObject("data").getJSONObject("futurePayloadInvariant").getString("unknownField").equals("preserved"));
            JSONObject peerCurrent=new ProductDiaryStore(peer.store.repo).read(id),small=new JSONObject(fixture.getJSONObject("payloadSmallEntry").toString());small.getJSONObject("data").put("title","packed to inline");
            peerBridge.handle("productPayloadEntrySave",new JSONObject().put("preparedRecord",small).put("dirtyFields",new JSONArray().put("body").put("title")).put("expectedLocalRevision",peerCurrent.getLong("localRevision")),null);JSONObject inlineJob=peer.store.repo.pending().getJSONObject(0);
            check("packed-to-small-entry-freezes-inline-cas-wire",!inlineJob.getJSONObject("wire").getJSONObject("changes").getJSONObject("_product").has("payload"));
            run(peerBridge);JSONObject inline=peer.store.repo.load("journalAggregate",id).getJSONObject("base");
            check("packed-to-inline-http-ack-and-canonical-body",peer.store.repo.pending().length()==0&&!ProductPayloadReader.packed(inline)&&inline.getJSONObject("data").getJSONObject("body").toString().contains("small payload body")&&inline.getJSONObject("data").has("_canonical"));
        }finally{if(firstBridge!=null)firstBridge.close();if(peerBridge!=null)peerBridge.close();if(firstTransport!=null)firstTransport.close();if(peerTransport!=null)peerTransport.close();if(primary!=null)primary.store.db.close();if(peer!=null)peer.store.db.close();}
    }
    private JSONObject run(ProductUiBridge bridge)throws Exception{bridge.handle("productSyncRun",new JSONObject(),null);long deadline=System.currentTimeMillis()+60000;while(bridge.status().optBoolean("running")&&System.currentTimeMillis()<deadline)Thread.sleep(80);JSONObject status=bridge.status();if(status.optBoolean("running"))throw new IOException("PAYLOAD_HTTP_TIMEOUT");return status;}
    private JSONObject asset(String name)throws Exception{try(InputStream in=getTargetContext().getAssets().open(name);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] block=new byte[65536];int n;while((n=in.read(block))!=-1)bytes.write(block,0,n);return new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));}}
}
