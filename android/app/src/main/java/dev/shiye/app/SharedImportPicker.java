package dev.shiye.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import java.io.InputStream;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** UI-owned document picker. All parsing/data actions stay in SharedSeedImport. */
final class SharedImportPicker implements AutoCloseable {
    static final int REQUEST = 109;
    interface Reply { void complete(JSONObject value, Exception error); }
    interface Progress { void update(JSONObject value); }
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedSeedImport worker;
    // Values do not retain their weak owner key. Revoked ports are never reactivated.
    private final Map<Object,Owner> owners = new WeakHashMap<>();
    private Task active;
    private volatile boolean closed;
    private static final class Owner {
        private boolean revoked;
        // Resource sets are only touched on the single worker queue.
        final Set<String> seeds = new HashSet<>(), stages = new HashSet<>();
        final Set<String> closedSeeds = new LinkedHashSet<>();
        synchronized boolean admit(){return !revoked;}
        synchronized void revoke(){revoked=true;}
    }
    private synchronized Owner owner(Object key){
        if(key==null)throw new IllegalArgumentException("SHARED_IMPORT_OWNER_REQUIRED");
        Owner state=owners.get(key);if(state==null){state=new Owner();owners.put(key,state);}return state;
    }
    private static final class Task {
        final Object owner;
        final Owner state;
        final String expected;
        final Reply reply;
        final Progress progress;
        final AtomicBoolean cancelled = new AtomicBoolean();
        Task(Object owner,Owner state,String expected,Reply reply,Progress progress){this.owner=owner;this.state=state;this.expected=expected;this.reply=reply;this.progress=progress;}
    }
    SharedImportPicker(Activity activity){this.activity=activity;}
    private SharedSeedImport worker() throws Exception {
        if(worker==null)worker=new SharedSeedImport(activity.getApplicationContext());
        return worker;
    }
    void choose(Object owner,String expected,Reply reply,Progress progress){
        if(closed){reply.complete(null,new Exception("SHARED_IMPORT_CLOSED"));return;}
        Owner state=owner(owner);
        if(!state.admit()){reply.complete(null,new Exception("SHARED_IMPORT_OWNER_REVOKED"));return;}
        if(active!=null){reply.complete(null,new Exception("SHARED_IMPORT_BUSY"));return;}
        if(expected!=null&&!expected.isEmpty()&&!expected.matches("[a-f0-9]{64}")){reply.complete(null,new Exception("SHARED_SEED_INVALID_EXPECTED_HASH"));return;}
        Task task=active=new Task(owner,state,expected==null||expected.isEmpty()?null:expected,reply,progress);
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/octet-stream","application/zip","application/x-zip-compressed"});
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try{activity.startActivityForResult(intent,REQUEST);}catch(Exception failure){active=null;reply.complete(null,failure);}
    }
    boolean selected(int request,int result,Intent data){
        if(request!=REQUEST)return false;
        Task task=active;
        if(task==null)return true;
        Uri uri=result==Activity.RESULT_OK&&data!=null?data.getData():null;
        if(uri==null){finish(task,null,new Exception("SHARED_SEED_CANCELLED"));return true;}
        if(!"content".equals(uri.getScheme())){finish(task,null,new Exception("SHARED_IMPORT_CONTENT_URI_REQUIRED"));return true;}
        io.execute(()->{
            JSONObject ticket=null;Exception failure=null;
            try{
                if(closed||!task.state.admit()||task.cancelled.get())throw new Exception("SHARED_SEED_CANCELLED");
                String name="";
                try(Cursor cursor=activity.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
                    if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);
                }
                String lower=name==null?"":name.toLowerCase(Locale.ROOT);
                if(!lower.endsWith(".syseed")&&!lower.endsWith(".zip"))throw new Exception("SHARED_IMPORT_FILE_TYPE_REQUIRED");
                try(InputStream input=activity.getContentResolver().openInputStream(uri)){
                    if(input==null)throw new Exception("SHARED_IMPORT_FILE_UNAVAILABLE");
                    final long[] last={0};
                    ticket=worker().prepare(input,task.expected,task.cancelled::get,(phase,done,total)->{
                        long now=android.os.SystemClock.uptimeMillis();
                        if(done!=total&&now-last[0]<100)return;last[0]=now;
                        JSONObject value=object("phase",phase,"completed",done,"total",total);
                        main.post(()->{if(!closed&&active==task&&task.state.admit()&&!task.cancelled.get())task.progress.update(value);});
                    });
                }
                task.state.seeds.add(ticket.getString("seedToken"));
                if(closed||!task.state.admit()||task.cancelled.get()){closeTicket(task.state,ticket.optString("seedToken"));ticket=null;throw new Exception("SHARED_SEED_CANCELLED");}
            }catch(Exception error){failure=error;}
            finish(task,ticket,failure);
        });
        return true;
    }
    private void finish(Task task,JSONObject ticket,Exception error){
        main.post(()->{
            boolean stale=closed||active!=task||!task.state.admit()||task.cancelled.get();
            if(active==task)active=null;
            if(stale&&!closed&&ticket!=null)io.execute(()->{try{closeTicket(task.state,ticket.optString("seedToken"));}catch(Exception ignored){}});
            if(!closed)task.reply.complete(stale?null:ticket,stale?new Exception("SHARED_SEED_CANCELLED"):error);
        });
    }
    void cancel(Object owner){
        Task task=active;if(task==null||task.owner!=owner)return;
        task.cancelled.set(true);
        // Keep the slot until the picker/prepare finishes: a late result cannot attach to a new task.
    }
    /** Navigation/port disposal revokes queued work, unlike cooperative UI cancel.
     * Admission on the worker queue is the boundary: an admitted atomic operation
     * may complete; future operations and continuations from this owner fail. */
    void releaseOwner(Object key){
        Owner state=owner(key);state.revoke();cancel(key);
        if(!closed)io.execute(()->cleanup(state));
    }
    private void cleanup(Owner state){
        for(String token:new HashSet<>(state.seeds))try{closeTicket(state,token);}catch(Exception ignored){}
        for(String token:new HashSet<>(state.stages))try{worker().handle("sharedSeedOriginalAbort",object("token",token));state.stages.remove(token);}catch(Exception ignored){}
        // Finished original handles may already belong to a durable JS transaction.
        // They survive navigation and are read/reconciled by the next runtime.
    }
    private JSONObject closeTicket(Owner state,String token)throws Exception{
        if(state.closedSeeds.contains(token))return object("closed",true,"replayed",true);
        if(!state.seeds.contains(token))throw new Exception("SHARED_IMPORT_TICKET_OWNER_MISMATCH");
        JSONObject result=worker().handle("sharedSeedClose",object("seedToken",token));
        state.seeds.remove(token);state.closedSeeds.add(token);
        if(state.closedSeeds.size()>512)state.closedSeeds.remove(state.closedSeeds.iterator().next());
        return result;
    }
    private JSONObject ownedAction(Owner state,String action,JSONObject input)throws Exception{
        if(action.equals("sharedSeedClose"))return closeTicket(state,input.optString("seedToken"));
        if((action.equals("sharedSeedManifestRead")||action.equals("sharedSeedReadMember"))&&!state.seeds.contains(input.optString("seedToken")))throw new Exception("SHARED_IMPORT_TICKET_OWNER_MISMATCH");
        if((action.equals("sharedSeedOriginalWrite")||action.equals("sharedSeedOriginalFinish")||action.equals("sharedSeedOriginalAbort"))&&!state.stages.contains(input.optString("token")))throw new Exception("SHARED_IMPORT_STAGE_OWNER_MISMATCH");
        JSONObject value=worker().handle(action,input);
        if(action.equals("sharedSeedOriginalBegin"))state.stages.add(value.getString("token"));
        if(action.equals("sharedSeedOriginalFinish")||action.equals("sharedSeedOriginalAbort"))state.stages.remove(input.optString("token"));
        return value;
    }
    void request(Object owner,String action,JSONObject input,Reply reply){
        if(closed){reply.complete(null,new Exception("SHARED_IMPORT_CLOSED"));return;}
        if(!SharedSeedImport.supports(action)){reply.complete(null,new Exception("SHARED_SEED_ACTION_FORBIDDEN"));return;}
        Owner state=owner(owner);
        if(!state.admit()){reply.complete(null,new Exception("SHARED_IMPORT_OWNER_REVOKED"));return;}
        final JSONObject payload;
        try{payload=input==null?new JSONObject():new JSONObject(input.toString());}catch(Exception error){reply.complete(null,error);return;}
        io.execute(()->{
            JSONObject value=null;Exception failure=null;
            try{
                if(closed||!state.admit())throw new Exception("SHARED_IMPORT_OWNER_REVOKED");
                value=ownedAction(state,action,payload);
            }catch(Exception error){failure=error;}
            final JSONObject result=value;final Exception error=failure;
            main.post(()->{if(!closed)reply.complete(result,error);});
        });
    }
    @Override public synchronized void close(){
        if(closed)return;
        closed=true;if(active!=null)active.cancelled.set(true);
        synchronized(this){for(Owner state:owners.values())state.revoke();}
        io.execute(()->{if(worker!=null)worker.close();});io.shutdown();
    }
    private static JSONObject object(Object... values){JSONObject result=new JSONObject();try{for(int i=0;i<values.length;i+=2)result.put((String)values[i],values[i+1]);}catch(Exception error){throw new IllegalStateException(error);}return result;}
}
