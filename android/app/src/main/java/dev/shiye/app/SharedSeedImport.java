package dev.shiye.app;
import android.content.Context;
import java.io.File;
import java.io.InputStream;
import org.json.JSONObject;

/** Dedicated data/settings host seam. The UI owns picker and WebMessage routing.
 * No MainActivity, Product DB, page content, implicit binding or token exposure. */
public final class SharedSeedImport implements AutoCloseable {
    private final SharedSeedBridge files;
    private final SharedBackendBridge backend;
    public SharedSeedImport(Context context)throws Exception {
        files=new SharedSeedBridge(new File(context.getFilesDir(),"shared-seed-v1"));
        backend=new SharedBackendBridge(new BackendServices(context));
    }
    public JSONObject prepare(InputStream source,String expectedSha256,SharedSeedFile.Cancellation cancellation,SharedSeedFile.Progress progress)throws Exception{if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())throw new Exception("SHARED_SEED_MAIN_THREAD");return files.prepareTicket(source,expectedSha256,cancellation,progress);}
    public static boolean supports(String action){return SharedSeedBridge.supports(action)||SharedBackendBridge.supports(action);}
    public JSONObject handle(String action,JSONObject input)throws Exception{
        if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())throw new Exception("SHARED_SEED_MAIN_THREAD");
        if(SharedSeedBridge.supports(action))return files.handle(action,input);
        if(SharedBackendBridge.supports(action))return backend.handle(action,input);
        throw new Exception("SHARED_SEED_ACTION_FORBIDDEN");
    }
    @Override public void close(){files.close();}
}
