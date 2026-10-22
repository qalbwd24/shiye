package dev.shiye.app;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import java.util.ArrayList;
import android.content.ContextWrapper;
import android.database.Cursor;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import org.json.JSONObject;

/** Isolated QA only. Never targets the installed dev.shiye.app package. */
public final class ProductPageLifecycleRunner extends Instrumentation {
    private int checks;
    private void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    @Override public void onStart(){
        Bundle result=new Bundle();MainActivity activity=null;
        try{
            if(!getTargetContext().getPackageName().equals("dev.shiye.productqa"))throw new AssertionError("QA target required");
            migration();
            Intent intent=new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=(MainActivity)startActivitySync(intent);final MainActivity h=activity;
            waitForIdleSync();runOnMainSync(()->SyncConnectionPage.show(h));
            check(h.backendPages.size()==1,"connection page owned by Activity");
            runOnMainSync(()->ProductSyncPage.show(h));check(h.backendPages.size()==2,"product child registered");
            final ArrayList<AutoCloseable> original=new ArrayList<>(h.backendPages);
            runOnMainSync(()->{try{original.get(0).close();original.get(0).close();}catch(Exception e){throw new RuntimeException(e);}});
            check(h.backendPages.size()==1,"dismiss unregisters once");
            runOnMainSync(()->{for(AutoCloseable page:new ArrayList<>(h.backendPages))try{page.close();}catch(Exception e){throw new RuntimeException(e);}});
            check(h.backendPages.isEmpty(),"normal close releases all pages");
            runOnMainSync(()->{SyncConnectionPage.show(h);ProductSyncPage.show(h);});
            final ArrayList<AutoCloseable> owned=new ArrayList<>(h.backendPages);check(owned.size()==2,"reopened pages own new transports");
            runOnMainSync(h::finish);waitForIdleSync();for(int n=0;n<30&&!h.destroyed;n++)Thread.sleep(100);
            check(h.destroyed&&h.backendPages.isEmpty(),"Activity destroy closes registry before store shutdown");
            for(AutoCloseable page:owned){java.lang.reflect.Field f=page.getClass().getDeclaredField("transport");f.setAccessible(true);AndroidSyncTransport t=(AndroidSyncTransport)f.get(page);try{t.health();throw new AssertionError("closed transport did network");}catch(AndroidSyncTransport.SyncException expected){check(expected.kind==AndroidSyncTransport.Failure.CANCELLED,"destroy cancels each transport");}}
            result.putString("summary","PASS "+checks+" actual Android lifecycle checks");finish(0,result);
        }catch(Throwable error){result.putString("summary","FAIL "+error.getClass().getSimpleName()+": "+error.getMessage());if(activity!=null){final MainActivity h=activity;runOnMainSync(h::finish);}finish(1,result);}
    }
    private JSONObject row(SQLiteDatabase db,String id)throws Exception{
        try(Cursor c=db.rawQuery("SELECT * FROM entries WHERE id=?",new String[]{id})){
            if(!c.moveToFirst())throw new AssertionError("missing migration row");JSONObject value=new JSONObject();
            for(int i=0;i<c.getColumnCount();i++)value.put(c.getColumnName(i),c.isNull(i)?JSONObject.NULL:c.getString(i));return value;
        }
    }
    private void migration()throws Exception{
        File file=new File(getTargetContext().getNoBackupFilesDir(),"migration-"+java.util.UUID.randomUUID()+".db");
        ContextWrapper context=new ContextWrapper(getTargetContext()){
            @Override public File getDatabasePath(String name){return file;}
            @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory){return SQLiteDatabase.openDatabase(file.getPath(),factory,SQLiteDatabase.CREATE_IF_NECESSARY);}
            @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory,DatabaseErrorHandler handler){return SQLiteDatabase.openDatabase(file.getPath(),factory,SQLiteDatabase.CREATE_IF_NECESSARY,handler);}
        };
        LocalStore initial=new LocalStore(context);initial.close();
        SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getPath(),null,SQLiteDatabase.OPEN_READWRITE);
        String id;try(Cursor c=db.rawQuery("SELECT id FROM entries LIMIT 1",null)){if(!c.moveToFirst())throw new AssertionError("synthetic seed absent");id=c.getString(0);}
        db.execSQL("UPDATE entries SET contentEditedAt=NULL WHERE id=?",new Object[]{id});JSONObject before=row(db,id);
        for(String table:new String[]{"product017_records","product017_pending","product017_meta","product017_conflicts","product017_mappings"})db.execSQL("DROP TABLE "+table);
        db.setVersion(3);db.close();
        LocalStore upgraded=new LocalStore(context);
        check(upgraded.withProduct(r->r.status()).getLong("records")==0,"migration adds empty product tables without importing old entries");
        db=SQLiteDatabase.openDatabase(file.getPath(),null,SQLiteDatabase.OPEN_READONLY);
        check(db.getVersion()==4,"host schema3 to schema4 upgrade executed");
        JSONObject after=row(db,id);check(before.toString().equals(after.toString()),"every legacy entry field and SQL null preserved");
        db.close();upgraded.close();
    }
}
