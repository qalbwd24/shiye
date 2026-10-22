package dev.shiye.app;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

/** Prepares content-addressed local bytes outside SQLite. The caller atomically binds
 * the returned original mapping to its immutable outbox operation; this class never
 * edits a wire base, pending intent, cursor or application preference. */
public final class ProductPayloadWriter {
    public static final int INLINE_BYTES=786432,MAX_BYTES=64*1024*1024;
    private final File directory;
    public ProductPayloadWriter(Context context)throws IOException{
        this(new File(context.getNoBackupFilesDir(),"product-originals-v1"));
    }
    /** Explicit native backend/test directory; never supplied by a WebView request. */
    ProductPayloadWriter(File privateDirectory)throws IOException{
        if(privateDirectory==null||!privateDirectory.isAbsolute())throw new IOException("PAYLOAD_PRIVATE_DIRECTORY_REQUIRED");
        directory=privateDirectory.getCanonicalFile();
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("PAYLOAD_PRIVATE_DIRECTORY_REQUIRED");
    }
    public static final class Prepared {
        private final JSONObject record,mapping;
        private Prepared(JSONObject record,JSONObject mapping){this.record=record;this.mapping=mapping;}
        public JSONObject record()throws Exception{return new JSONObject(record.toString());}
        public JSONObject original()throws Exception{return mapping==null?null:new JSONObject(mapping.toString());}
    }
    public Prepared prepare(JSONObject fullRecord)throws Exception{
        active();
        JSONObject record=new JSONObject(fullRecord.toString()),data=record.getJSONObject("data"),meta=data.getJSONObject("_product");
        if(meta.has("payload"))throw new IOException("PRODUCT_PAYLOAD_NOT_HYDRATED");
        if(!"entry".equals(meta.optString("kind")))throw new IOException("PRODUCT_PAYLOAD_WRITER_ENTRY_ONLY");
        ProductDiaryStore.validatePrepared(record);
        byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_BYTES)throw new IOException("PRODUCT_PAYLOAD_TOO_LARGE");
        if(bytes.length<=INLINE_BYTES)return new Prepared(record,null);
        String sha=hex(MessageDigest.getInstance("SHA-256").digest(bytes)),id="payload-"+sha;
        File target=new File(directory,"payload-"+sha),part=new File(directory,"payload-part-"+UUID.randomUUID());
        if(target.exists())verify(target,bytes.length,sha);
        else{
            Exception failure=null;
            try{
                try(FileOutputStream out=new FileOutputStream(part)){for(int offset=0;offset<bytes.length;offset+=262144){active();out.write(bytes,offset,Math.min(262144,bytes.length-offset));}out.getFD().sync();}
                // Only identical validated bytes may use this content-addressed target.
                try{Files.move(part.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);}
                catch(FileAlreadyExistsException collision){verify(target,bytes.length,sha);}
            }catch(Exception error){failure=error;throw error;}
            finally{try{Files.deleteIfExists(part.toPath());}catch(IOException cleanup){if(failure!=null)failure.addSuppressed(cleanup);else throw cleanup;}}
        }
        JSONObject reference=new JSONObject().put("assetId",id).put("sha256",sha).put("size",bytes.length);
        JSONObject packedMeta=new JSONObject(meta.toString()).put("payload",reference);
        record.put("data",new JSONObject().put("_product",packedMeta));
        JSONObject mapping=new JSONObject(reference.toString()).put("id",id).put("mime","application/vnd.shiye.product+json")
            .put("name","product-record.json").put("path",target.getCanonicalPath());
        return new Prepared(record,mapping);
    }
    private static void verify(File file,long size,String sha)throws Exception{
        if(!file.isFile()||file.length()!=size)throw new IOException("PRODUCT_PAYLOAD_FILE_CONFLICT");
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new BufferedInputStream(new FileInputStream(file))){byte[] block=new byte[262144];int n;while((n=in.read(block))!=-1){active();hash.update(block,0,n);}}
        if(!sha.equals(hex(hash.digest())))throw new IOException("PRODUCT_PAYLOAD_FILE_CONFLICT");
    }
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte b:bytes)text.append(String.format(Locale.ROOT,"%02x",b&255));return text.toString();}
    private static void active()throws IOException{if(Thread.currentThread().isInterrupted())throw new IOException("PRODUCT_PAYLOAD_CANCELLED");}
}
