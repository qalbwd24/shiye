package dev.shiye.app;

import android.app.Instrumentation;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** Own package/private DB only. No Activity, network, LocalStore, or device data. */
public final class ProductRepositoryProbe extends Instrumentation {
    private final JSONArray checks = new JSONArray();
    private JSONObject identity;
    private Context context;
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle finish = new Bundle(); JSONObject report = new JSONObject();
        try {
            context = getTargetContext();
            report.put("synthetic",true).put("androidVerified",true).put("storage","android.database.sqlite.SQLiteDatabase");
            run(); report.put("ok",true);
        } catch (Throwable error) {
            try { report.put("ok",false).put("failure",error.getClass().getSimpleName()+":"+error.getMessage()); } catch(Exception ignored) { }
        } finally {
            try {
                report.put("checks",checks).put("assertions",checks.length());
                try(FileOutputStream out=context.openFileOutput("repository-result.json",Context.MODE_PRIVATE)) { out.write(report.toString(2).getBytes(StandardCharsets.UTF_8)); }
                finish.putString("report","repository-result.json"); finish.putBoolean("ok",report.optBoolean("ok"));
            } catch(Exception error) { finish.putString("failure",error.getClass().getSimpleName()); }
            finish(report.optBoolean("ok")?0:1,finish);
        }
    }
    private void run() throws Exception {
        JSONObject fixture=asset("fixture.json"), oracle=asset("reference.json");
        identity=fixture.getJSONObject("identityExample");
        File file=new File(context.getFilesDir(),"repository-"+java.util.UUID.randomUUID()+".sqlite");
        final SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(file,null);
        try(Cursor pragma=db.rawQuery("PRAGMA secure_delete=ON",null)){pragma.moveToFirst();}
        // Simulate schema3 data: this test initialization must never rewrite existing tables.
        db.execSQL("CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,body TEXT,revision INTEGER,contentEditedAt TEXT)");
        db.execSQL("INSERT OR REPLACE INTO entries VALUES('old-local','synthetic-old-body',7,NULL)");
        db.execSQL("CREATE TABLE probe_projection(id TEXT PRIMARY KEY,body TEXT)");
        db.execSQL("INSERT INTO probe_projection VALUES('marker','synthetic-old-body')");
        db.execSQL("PRAGMA user_version=3");
        ProductRepository repository=new ProductRepository(db); repository.initialize();
        assertTrue("schema3-data-preserved",scalar(db,"SELECT body FROM entries WHERE id='old-local'").equals("synthetic-old-body"));
        assertTrue("repository-does-not-bump-host-schema",scalar(db,"PRAGMA user_version").equals("3"));
        repository.bindIdentity(new JSONObject(identity.toString()).put("protocol",1));
        JSONObject initial=oracle.getJSONObject("initial"); String type=initial.getString("entityType"),id=initial.getString("entityId");
        repository.applyRemotePage("snapshot",JSONObject.NULL,page(new JSONArray().put(initial),"snapshot-a",false,"pull-a"),identity);
        equal("golden-full-envelope",repository.load(type,id).getJSONObject("local"),initial);
        // Complete canonical golden transport preserved even while native editing stays disabled.
        JSONObject entry=fixture.getJSONObject("transportExample");
        repository.applyRemotePage("pull","pull-a",page(new JSONArray().put(entry),"pull-b",false,null),identity);
        equal("golden-canonical-complete",repository.load(entry.getString("entityType"),entry.getString("entityId")).getJSONObject("local"),entry);
        fails("canonical-protected",()->repository.enqueueIntent(edit(entry.getString("entityType"),entry.getString("entityId"),new JSONObject().put("title","bad")),0,null));
        JSONArray incoming=new JSONArray();
        for(int i=0;i<fixture.getJSONArray("records").length();i++) {
            JSONObject record=new JSONObject(fixture.getJSONArray("records").getJSONObject(i).toString());
            if(!record.getString("entityId").equals(id) && !record.getString("entityId").equals(entry.getString("entityId")))incoming.put(record.put("revision",1).put("state","active"));
        }
        JSONObject opaque=new JSONObject().put("entityType","futureType").put("entityId","opaque").put("revision",1).put("state","active")
            .put("data",new JSONObject().put("unknown",new JSONArray().put("18446744073709551615").put(JSONObject.NULL))).put("topExtension",new JSONObject().put("future",true));
        incoming.put(opaque); repository.applyRemotePage("pull","pull-b",page(incoming,"pull-c",false,null),identity);
        equal("unknown-envelope-roundtrip",repository.load("futureType","opaque").getJSONObject("local"),opaque);
        fails("opaque-readonly",()->repository.enqueueIntent(edit("futureType","opaque",new JSONObject().put("a",1)),0,null));
        JSONObject send=fixture.getJSONObject("requests").getJSONObject("sendMessages"),expected=fixture.getJSONObject("expected");
        String source=send.getString("sourceId"),room=send.getString("roomId");
        assertTrue("conversation-golden-id",ProductRepository.productConversationId(source,room).equals(expected.getString("conversationId")));
        for(int n=0;n<send.getJSONArray("messages").length();n++) {
            JSONObject message=send.getJSONArray("messages").getJSONObject(n); String full=ProductRepository.productMessageId(source,room,message.getString("id"));
            assertTrue("message-golden-id-"+n,full.equals(expected.getJSONArray("messageIds").getString(n)));
            assertTrue("unsigned20-id-preserved-"+n,repository.load("chatMessage",full).getJSONObject("local").getJSONObject("data").getString("id").equals(message.getString("id")));
        }
        String reply=repository.load("chatMessage",expected.getJSONArray("messageIds").getString(1)).getJSONObject("local").getJSONObject("data").getString("replyTo");
        assertTrue("unsigned20-reply-preserved",reply.equals("18446744073709551614"));
        repository.transaction(tx->{tx.putMapping("tl","18446744073709551615",new JSONObject().put("entityId",expected.getJSONArray("messageIds").getString(1)));return null;});
        fails("mapping-conflict-preserved",()->repository.transaction(tx->{tx.putMapping("tl","18446744073709551615",new JSONObject().put("entityId","different"));return null;}));
        JSONObject first=repository.enqueueIntent(edit(type,id,new JSONObject().put("name","first")),0,null);
        JSONObject firstJob=repository.prepareNextPush(identity),wire=firstJob.getJSONObject("wire");
        assertTrue("trusted-base-1",wire.getLong("baseRevision")==oracle.getLong("firstWireBase"));
        JSONObject changes=new JSONObject().put("name","second").put("list",new JSONArray().put("a").put(JSONObject.NULL)).put("explicitNull",JSONObject.NULL);
        repository.enqueueIntent(edit(type,id,changes),1,null);
        equal("fixed-wire-new-edit",repository.prepareNextPush(identity).getJSONObject("wire"),wire);
        JSONObject firstRemote=oracle.getJSONObject("afterFirstAck").getJSONObject("base");
        repository.ackOperation(first.getString("operationId"),new JSONObject().put("operationId",first.getString("operationId")).put("status","accepted").put("entity",firstRemote),identity);
        equal("late-ack-preserves-new-local",repository.load(type,id).getJSONObject("local"),oracle.getJSONObject("afterFirstAck").getJSONObject("local"));
        assertTrue("localrevision-not-reset-by-ack",repository.load(type,id).getLong("localRevision")==2);
        assertTrue("late-ack-removes-only-snapshot",repository.pending().length()==1);
        JSONObject secondJob=repository.prepareNextPush(identity);
        assertTrue("next-wire-trusted-base-2",secondJob.getJSONObject("wire").getLong("baseRevision")==oracle.getLong("secondWireBase"));
        assertTrue("null-list-wire-preserved",secondJob.getJSONObject("wire").getJSONObject("changes").isNull("explicitNull"));
        repository.ackOperation(secondJob.getString("operationId"),new JSONObject().put("operationId",secondJob.getString("operationId")).put("status","rejected").put("entity",firstRemote).put("conflictId","synthetic-conflict"),identity);
        equal("shared-oracle-rejected-local",repository.load(type,id).getJSONObject("local"),oracle.getJSONObject("afterRejected").getJSONObject("local"));
        assertTrue("blocked-head-does-not-spin",repository.prepareNextPush(identity)==null);
        JSONObject tombstone=oracle.getJSONObject("afterWithdrawal").getJSONObject("base");
        repository.applyRemotePage("pull","pull-c",page(new JSONArray().put(tombstone),"pull-d",false,null),identity);
        equal("shared-oracle-withdrawal",repository.load(type,id).getJSONObject("local"),oracle.getJSONObject("afterWithdrawal").getJSONObject("local"));
        assertTrue("withdrawal-purges-sensitive-pending",repository.pending().length()==oracle.getInt("withdrawalPending"));
        assertTrue("withdrawal-base-body-empty",repository.load(type,id).getJSONObject("base").getJSONObject("data").length()==0);
        fails("withdrawn-cannot-edit",()->repository.enqueueIntent(edit(type,id,new JSONObject().put("name","resurrect")),2,null));
        JSONObject wrong=new JSONObject(identity.toString()).put("epoch","wrong-epoch");
        fails("identity-mismatch-pause",()->repository.bindIdentity(new JSONObject(wrong.toString()).put("protocol",1)));
        fails("stale-page-no-progress",()->repository.applyRemotePage("pull","pull-c",page(new JSONArray(),"not-applied",false,null),identity));
        JSONObject before=repository.metadata(); int beforeRows=repository.records().length();
        JSONArray badPage=new JSONArray().put(new JSONObject(opaque.toString()).put("entityId","must-rollback")).put(new JSONObject().put("entityType","bad"));
        fails("page-all-or-nothing",()->repository.applyRemotePage("pull","pull-d",page(badPage,"bad-cursor",false,null),identity));
        equal("failed-page-cursor-preserved",repository.metadata(),before);
        assertTrue("failed-page-entity-rollback",repository.records().length()==beforeRows && repository.load("futureType","must-rollback")==null);
        // Atomic callback errors roll back BOTH host tables and repository job/record writes.
        JSONObject local=copyEnvelope(initial,"local-only",0);
        repository.transaction(tx->{tx.preserveLocalOnly(local,0);return null;});
        JSONObject create=new JSONObject().put("entityType",type).put("entityId","atomic").put("command","create").put("data",initial.getJSONObject("data"));
        fails("intent-host-projection-rollback",()->repository.enqueueIntent(create,0,(tx,job)->{tx.database().execSQL("UPDATE probe_projection SET body='must-rollback' WHERE id='marker'");throw new Exception("fixture-failure");}));
        assertTrue("intent-and-host-both-rollback",repository.load(type,"atomic")==null && repository.pending().length()==0 && scalar(db,"SELECT body FROM probe_projection WHERE id='marker'").equals("synthetic-old-body"));
        fails("command-host-rollback",()->repository.enqueueCommand("sendMessages",send,identity,(tx,job)->{tx.database().execSQL("UPDATE probe_projection SET body='bad-command' WHERE id='marker'");throw new Exception("fixture-failure");}));
        assertTrue("command-and-host-both-rollback",repository.pending().length()==0 && scalar(db,"SELECT body FROM probe_projection WHERE id='marker'").equals("synthetic-old-body"));
        JSONObject command=repository.enqueueCommand("sendMessages",send,identity,(tx,job)->tx.database().execSQL("UPDATE probe_projection SET body='command-local' WHERE id='marker'"));
        equal("immutable-command-retry",repository.nextCommand(identity),command);
        fails("command-ack-rollback",()->repository.ackCommand(command.getString("operationId"),new JSONObject(),identity,(tx,job,receipt)->{tx.database().execSQL("UPDATE probe_projection SET body='bad-ack' WHERE id='marker'");throw new Exception("fixture-failure");}));
        assertTrue("failed-command-ack-retains-job",repository.pending().length()==1 && scalar(db,"SELECT body FROM probe_projection WHERE id='marker'").equals("command-local"));
        repository.ackCommand(command.getString("operationId"),new JSONObject(),identity,(tx,job,receipt)->tx.database().execSQL("UPDATE probe_projection SET body='newer-draft' WHERE id='marker'"));
        assertTrue("receipt-no-blanket-draft-clear",repository.pending().length()==0 && scalar(db,"SELECT body FROM probe_projection WHERE id='marker'").equals("newer-draft"));
        repository.enqueueCommand("sendMessages",send,identity,(tx,job)->{});
        JSONObject withdrawnMessage=new JSONObject().put("entityType","chatMessage").put("entityId",expected.getJSONArray("messageIds").getString(0))
            .put("revision",2).put("state","withdrawn").put("data",new JSONObject());
        repository.transaction(tx->{tx.acceptEntity(withdrawnMessage);return null;});
        assertTrue("withdrawal-cancels-sensitive-fixed-command",repository.pending().length()==0 && repository.load("chatMessage",withdrawnMessage.getString("entityId")).getJSONObject("local").getJSONObject("data").length()==0);
        JSONObject comment=new JSONObject().put("entityType","comment").put("entityId","revisit-comment:fixture").put("revision",1).put("state","active")
            .put("data",new JSONObject().put("operationId","fixture-comment-op").put("text","synthetic-original"));
        repository.transaction(tx->{tx.acceptEntity(comment);return null;});
        repository.enqueueCommand("addComment",new JSONObject().put("operationId","fixture-comment-op").put("text","synthetic-original"),identity,(tx,job)->{});
        repository.transaction(tx->{tx.acceptEntity(new JSONObject(comment.toString()).put("revision",2).put("state","withdrawn").put("data",new JSONObject()));return null;});
        assertTrue("comment-operation-resolves-before-tombstone-purge",repository.pending().length()==0 && repository.load("comment","revisit-comment:fixture").getJSONObject("local").getJSONObject("data").length()==0);
        // Interrupted snapshot must resume; neither pages nor an empty remote erase local-only.
        repository.applyRemotePage("snapshot",JSONObject.NULL,page(new JSONArray().put(opaque),"snap-part",true,null),identity);
        assertTrue("snapshot-staging-not-initial-cursor",repository.metadata().getString("cursor").equals("pull-d") && repository.metadata().getString("snapshotCursor").equals("snap-part"));
        db.close(); SQLiteDatabase reopenedDb=SQLiteDatabase.openOrCreateDatabase(file,null); ProductRepository reopened=new ProductRepository(reopenedDb);reopened.initialize();
        assertTrue("reopen-local-only-preserved",reopened.load(type,"local-only").getJSONObject("local").getJSONObject("data").getString("name").equals(initial.getJSONObject("data").getString("name")));
        assertTrue("reopen-snapshot-position",reopened.metadata().getString("snapshotCursor").equals("snap-part"));
        reopened.applyRemotePage("snapshot","snap-part",page(new JSONArray(),"snap-done",false,"empty-remote-checkpoint"),identity);
        assertTrue("empty-remote-does-not-clear-local-only",reopened.load(type,"local-only").getJSONObject("local").getJSONObject("data").length()>0);
        assertTrue("empty-remote-does-not-queue-old-local",reopened.pending().length()==0);
        assertTrue("final-checkpoint-only-from-receive",reopened.metadata().getString("cursor").equals("empty-remote-checkpoint"));
        assertTrue("withdrawal-survives-empty-resnapshot",reopened.load(type,id).getJSONObject("base").getString("state").equals("withdrawn"));
        fails("withdrawal-cannot-resurrect-with-newer-active",()->reopened.transaction(tx->{tx.acceptEntity(new JSONObject(initial.toString()).put("revision",99));return null;}));
        ProductRepository.Tx[] leaked=new ProductRepository.Tx[1];
        reopened.transaction(tx->{leaked[0]=tx;return null;});
        fails("expired-tx-not-reusable",()->reopened.transaction(tx->{leaked[0].getMeta();return null;}));
        reopenedDb.beginTransaction();
        try { reopened.inCurrentTransaction(tx->{tx.putMapping("outer","x",new JSONObject().put("id","durable"));return null;}); /* simulate outer failure */ }
        finally { reopenedDb.endTransaction(); }
        assertTrue("outer-store-owns-rollback",reopened.transaction(tx->tx.getMapping("outer","x"))==null);
        JSONObject status=reopened.status();assertTrue("lightweight-counter-status",status.getLong("records")==reopened.records().length()&&status.getLong("pending")==0&&!status.getBoolean("contentSyncEnabled"));
        assertTrue("schema3-original-remains-exact",scalar(reopenedDb,"SELECT body||':'||revision||':'||COALESCE(contentEditedAt,'NULL') FROM entries WHERE id='old-local'").equals("synthetic-old-body:7:NULL"));
        JSONObject numericSend=new JSONObject(send.toString());numericSend.getJSONArray("messages").getJSONObject(0).put("id",123);
        fails("numeric-message-rejected",()->reopened.enqueueCommand("sendMessages",numericSend,identity,(tx,job)->{}));
        fails("wrong-identity-command-blocked",()->reopened.nextCommand(wrong));
        JSONObject forgedCreate=new JSONObject(create.toString()).put("entityId","durable-create").put("operationId","forged").put("baseRevision",999999);
        reopened.enqueueIntent(forgedCreate,0,null);JSONObject frozen=reopened.prepareNextPush(identity);
        assertTrue("caller-cannot-forge-trusted-base",frozen.getJSONObject("wire").getLong("baseRevision")==0&&!frozen.getString("operationId").equals("forged"));
        reopenedDb.close();SQLiteDatabase finalDb=SQLiteDatabase.openOrCreateDatabase(file,null);ProductRepository durable=new ProductRepository(finalDb);durable.initialize();
        equal("fixed-wire-survives-reopen",durable.prepareNextPush(identity).getJSONObject("wire"),frozen.getJSONObject("wire"));
        assertTrue("local-commit-outbox-survives-reopen",durable.load(type,"durable-create").getLong("localRevision")==1&&durable.pending().length()==1);
        finalDb.close();
    }
    private static JSONObject copyEnvelope(JSONObject source,String id,int revision)throws Exception{return new JSONObject(source.toString()).put("entityId",id).put("revision",revision);}
    private static JSONObject edit(String type,String id,JSONObject changes)throws Exception{return new JSONObject().put("entityType",type).put("entityId",id).put("command","updateFields").put("changes",changes);}
    private static JSONObject page(JSONArray entities,String cursor,boolean more,String checkpoint)throws Exception{
        JSONObject value=new JSONObject().put("entities",entities).put("cursor",cursor).put("hasMore",more);if(checkpoint!=null)value.put("checkpoint",checkpoint);return value;
    }
    private JSONObject asset(String name)throws Exception{try(InputStream in=context.getAssets().open(name)){return new JSONObject(new String(read(in),StandardCharsets.UTF_8));}}
    private static byte[] read(InputStream in)throws Exception{java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return out.toByteArray();}
    private static String scalar(SQLiteDatabase database,String sql){try(Cursor c=database.rawQuery(sql,null)){if(!c.moveToFirst())return "";return c.getString(0);}}
    private void assertTrue(String name,boolean condition)throws Exception{if(!condition)throw new AssertionError(name);checks.put(name);}
    private void equal(String name,Object actual,Object expected)throws Exception{assertTrue(name,structural(actual,expected));}
    private static boolean structural(Object a,Object b)throws Exception{
        if(a==null||a==JSONObject.NULL)return b==null||b==JSONObject.NULL;if(b==null||b==JSONObject.NULL)return false;
        if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> i=x.keys();i.hasNext();){String k=i.next();if(!y.has(k)||!structural(x.get(k),y.get(k)))return false;}return true;}
        if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int n=0;n<x.length();n++)if(!structural(x.get(n),y.get(n)))return false;return true;}return a.equals(b);
    }
    @FunctionalInterface interface Throwing {void run()throws Exception;}
    private void fails(String name,Throwing task)throws Exception{boolean failed=false;try{task.run();}catch(Exception expected){failed=true;}assertTrue(name,failed);}
}
