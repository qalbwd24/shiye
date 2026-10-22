package dev.shiye.app;

import android.util.Base64;
import android.webkit.WebMessagePort;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Private originals, explicit bounded chunks. Paths and tokens never enter the sync DTO. */
final class ProductMediaBridge implements AutoCloseable {
    private final MainActivity h;private final ProductChatStore chat;private final File directory;
    private final Map<String,Transfer> imports=new HashMap<>();
    private static final long MAX=64L*1024*1024;
    private static final int CHUNK=131072;
    private static final class Transfer {String token,id,name,mime;long size,written;File part;WebMessagePort owner;}
    ProductMediaBridge(MainActivity host,ProductChatStore chats)throws Exception{h=host;chat=chats;directory=new File(h.getFilesDir(),"product019-originals");if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法建立本机原件目录");}
    synchronized JSONObject handle(String action,JSONObject q,WebMessagePort owner)throws Exception{
        if(owner==null)throw new IOException("MEDIA_OWNER_REQUIRED");
        if(!Arrays.asList("mediaImportStart","mediaImportChunk","mediaImportComplete","mediaImportCancel","chatMedia").contains(action))throw new IOException("MEDIA_ACTION_NOT_SUPPORTED");
        if(action.equals("mediaImportStart")){
            long size=q.optLong("size",-1);String name=q.optString("name","附件"),mime=q.optString("mime","application/octet-stream");
            if(size<1||size>MAX||name.length()>250||name.matches(".*[\\x00-\\x1f\\x7f].*")||mime.length()>200||!mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+"))throw new IOException("MEDIA_INVALID_PARAMETERS");
            if(imports.size()>=4)throw new IOException("请先完成正在导入的附件");
            Transfer t=new Transfer();t.token=UUID.randomUUID().toString();t.id=UUID.randomUUID().toString();t.name=name;t.mime=mime;t.size=size;t.owner=owner;t.part=new File(directory,t.id+".part");if(!t.part.createNewFile())throw new IOException("附件会话未建立");imports.put(t.token,t);return new JSONObject().put("token",t.token);
        }
        if(action.equals("chatMedia"))return read(q);
        Transfer t=imports.get(q.optString("token"));if(t==null||t.owner!=owner)throw new IOException("附件导入会话已失效");
        if(action.equals("mediaImportCancel")){imports.remove(t.token);if(t.part.getName().endsWith(".part")&&t.part.exists()&&!t.part.delete())throw new IOException("临时附件稍后清理");return new JSONObject().put("cancelled",true);}
        if(action.equals("mediaImportChunk")){
            String value=q.optString("base64");if(value.length()>CHUNK*4/3+8||value.length()%4!=0||!value.matches("[A-Za-z0-9+/]*={0,2}")||q.optLong("offset",-1)!=t.written)throw new IOException("MEDIA_INVALID_CHUNK");byte[] bytes=Base64.decode(value,Base64.NO_WRAP);
            if(!Base64.encodeToString(bytes,Base64.NO_WRAP).equals(value))throw new IOException("MEDIA_INVALID_CHUNK");
            if(bytes.length<1||bytes.length>CHUNK||t.written+bytes.length>t.size)throw new IOException("附件片段长度无效");try(FileOutputStream f=new FileOutputStream(t.part,true)){f.write(bytes);}t.written+=bytes.length;return new JSONObject().put("offset",t.written);
        }
        if(!action.equals("mediaImportComplete")||t.written!=t.size)throw new IOException("附件尚未完整保存");
        try(FileOutputStream f=new FileOutputStream(t.part,true)){f.getFD().sync();}
        if(!t.part.isFile()||t.part.length()!=t.size)throw new IOException("MEDIA_SIZE_MISMATCH");String hash=hash(t.part);File target=new File(directory,t.id);if(!t.part.equals(target)){if(!t.part.renameTo(target))throw new IOException("MEDIA_PUBLISH_FAILED");t.part=target;}
        JSONObject asset=new JSONObject().put("id",t.id).put("assetId",t.id).put("name",t.name).put("mime",t.mime).put("size",t.size).put("sha256",hash);
        JSONObject saved=new JSONObject(asset.toString()).put("path",target.getCanonicalPath());
        h.store.withProduct(r->r.transaction(tx->{tx.putMapping("product-original019",t.id,saved);chat.registerMedia(tx,asset);return null;}));imports.remove(t.token);return asset;
    }
    JSONObject metadata(String id)throws Exception{
        // An ID selects a parameterized private mapping only; it is never a filesystem path.
        if(id==null||!id.matches("[A-Za-z0-9_:@.-]{1,160}"))throw new IOException("无效资源身份");
        JSONObject m=h.store.withProduct(r->r.transaction(tx->{if(assetRedacted(tx.getEntity("asset",id)))throw new IOException("MEDIA_ASSET_REDACTED");return tx.getMapping("product-original019",id);}));
        if(m==null)throw new IOException("原件尚未下载到本机");return m;
    }
    static boolean assetRedacted(JSONObject record){
        if(record==null)return false;
        for(String field:new String[]{"base","local"}){JSONObject entity=record.optJSONObject(field);if(entity!=null&&!"active".equals(entity.optString("state")))return true;}
        return false;
    }
    static boolean chatCompatible(JSONObject asset){
        return !"application/vnd.shiye.product+json".equals(asset.optString("mime"))&&asset.optString("assetId",asset.optString("id")).matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")&&asset.optLong("size",-1)>0&&asset.optLong("size")<=536870912L&&asset.optString("mime").length()<=200&&asset.optString("mime").matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+");
    }
    File file(String id)throws Exception{JSONObject m=metadata(id);File f=new File(m.getString("path")).getCanonicalFile();String root=directory.getCanonicalPath()+File.separator;
        if(!f.getPath().startsWith(root)&&!f.getPath().startsWith(new File(h.getFilesDir(),"media").getCanonicalPath()+File.separator)&&!f.getPath().startsWith(new File(h.getNoBackupFilesDir(),"product-originals-v1").getCanonicalPath()+File.separator))throw new IOException("原件路径不在本机资源目录");
        if(!f.isFile()||f.length()!=m.getLong("size"))throw new IOException("原件尚未完整就绪");return f;}
    JSONObject read(JSONObject q)throws Exception{String id=q.optString("assetId");JSONObject m=metadata(id);File f=file(id);long offset=q.optLong("offset",0);int length=q.optInt("length",CHUNK);if(offset<0||offset>f.length()||length<1||length>CHUNK)throw new IOException("无效原件读取范围");
        byte[] bytes=new byte[(int)Math.min(length,f.length()-offset)];try(RandomAccessFile in=new RandomAccessFile(f,"r")){in.seek(offset);in.readFully(bytes);}return new JSONObject().put("assetId",id).put("offset",offset).put("base64",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("mime",m.optString("mime","application/octet-stream")).put("name",m.optString("name",id)).put("size",m.getLong("size")).put("sha256",m.getString("sha256")).put("complete",offset+bytes.length==f.length());}
    synchronized void registerLegacy(JSONObject asset)throws Exception{String id=asset.optString("id");File f=h.store.mediaFile(id);if(!f.isFile()||f.length()<1||f.length()>MAX)throw new IOException("MEDIA_NOT_READY");JSONObject m=new JSONObject().put("assetId",id).put("id",id).put("name",asset.optString("name","图片")).put("mime",asset.optString("mime","application/octet-stream")).put("size",f.length()).put("sha256",hash(f));JSONObject saved=new JSONObject(m.toString()).put("path",f.getCanonicalPath());h.store.withProduct(r->r.transaction(tx->{tx.putMapping("product-original019",id,saved);chat.registerMedia(tx,m);return null;}));}
    /** Native-only, after ProductOriginals has returned a complete verified private file. */
    synchronized void registerDownloaded(JSONObject asset,File file)throws Exception{
        File f=file.getCanonicalFile();String root=new File(h.getNoBackupFilesDir(),"product-originals-v1").getCanonicalPath()+File.separator;
        if(!f.getPath().startsWith(root)||!f.isFile()||f.length()!=asset.getLong("size")||!hash(f).equals(asset.getString("sha256")))throw new IOException("MEDIA_ORIGINAL_NOT_READY");
        JSONObject m=new JSONObject(asset.toString()).put("id",asset.getString("assetId")),saved=new JSONObject(m.toString()).put("path",f.getCanonicalPath());
        h.store.withProduct(r->r.transaction(tx->{if(assetRedacted(tx.getEntity("asset",m.getString("assetId"))))throw new IOException("MEDIA_ASSET_REDACTED");tx.putMapping("product-original019",m.getString("assetId"),saved);if(chatCompatible(m))chat.registerMedia(tx,m);return null;}));
    }
    synchronized void cancelOwner(WebMessagePort owner){for(Iterator<Transfer> i=imports.values().iterator();i.hasNext();){Transfer t=i.next();if(t.owner==owner){if(t.part.getName().endsWith(".part"))t.part.delete();i.remove();}}}
    static String hash(File f)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(f)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    @Override public synchronized void close(){for(Transfer t:imports.values())if(t.part.getName().endsWith(".part"))t.part.delete();imports.clear();}
}
