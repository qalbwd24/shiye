package dev.shiye.app;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
/** Console-only selected-file/native data port. args[0] is fixed by the host
 * fixture; commands cannot choose a filesystem path. No Android UI or DB. */
public final class SharedSeedPortProbe {
    public static void main(String[] args)throws Exception {
        try(SharedSeedBridge bridge=new SharedSeedBridge(new File(args[1]));BufferedReader reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8))){
            String line;while((line=reader.readLine())!=null){JSONObject output=new JSONObject();
                try{JSONObject q=new JSONObject(line);String action=q.getString("action");JSONObject result;
                    if("native-selected-prepare".equals(action)){try(InputStream in=new FileInputStream(args[0])){result=bridge.prepareTicket(in,null,null,null);}}
                    else result=bridge.handle(action,q.optJSONObject("input"));
                    output.put("ok",true).put("result",result);
                }catch(Exception error){output.put("ok",false).put("code",error.getMessage()==null?"NATIVE_FAILURE":error.getMessage());}
                System.out.println(output.toString());System.out.flush();
            }
        }
    }
}
