package dev.shiye.app;

import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.*;

/** Fixed private file ports only. Business entities are published by the shared JS
 * IndexedDB owner; this class cannot write Product/SQLite or contact a server. */
final class SharedSeedBridge implements AutoCloseable {
    private final File containers, originals;
    private final Map<String,SharedSeedFile.Prepared> seeds=new HashMap<>();
    private final Map<String,Stage> stages=new HashMap<>();
    private boolean closed;
    private static final class Stage {
        final String token;final JSONObject asset;final File file;final MessageDigest digest;
        long next;String handle;
        Stage(String token,JSONObject asset,File file)throws Exception{this.token=token;this.asset=asset;this.file=file;digest=MessageDigest.getInstance("SHA-256");}
    }
    SharedSeedBridge(File privateRoot)throws Exception {
        if(privateRoot==null||!privateRoot.isAbsolute())throw bad("SHARED_SEED_PRIVATE_DIRECTORY_REQUIRED");
        containers=new File(privateRoot,"containers");originals=new File(privateRoot,"originals");
        if(!containers.isDirectory()&&!containers.mkdirs()||!originals.isDirectory()&&!originals.mkdirs())throw bad("SHARED_SEED_STAGING_FAILED");
    }
    private static Exception bad(String code){return new IOException(code);}
    private void active()throws Exception{if(closed)throw bad("SHARED_SEED_CLOSED");}
    static boolean supports(String action){return Arrays.asList("sharedSeedVerifyAttestation","sharedSeedStorageBudget","sharedSeedManifestRead","sharedSeedReadMember","sharedSeedClose","sharedSeedOriginalBegin","sharedSeedOriginalWrite","sharedSeedOriginalFinish","sharedSeedOriginalAbort","sharedSeedOriginalRead","sharedSeedOriginalDiscard").contains(action);}
    /** Called only with a native picker/file stream, never a WebView-supplied path. */
    synchronized JSONObject prepare(InputStream source,String expectedSha256,SharedSeedFile.Cancellation cancel,SharedSeedFile.Progress progress)throws Exception{
        active();if(seeds.size()>=2)throw bad("SHARED_SEED_STAGING_LIMIT");
        SharedSeedFile.Prepared seed=SharedSeedFile.prepare(source,containers,expectedSha256,cancel,progress);
        String token=UUID.randomUUID().toString();seeds.put(token,seed);
        return new JSONObject().put("seedToken",token).put("manifest",seed.manifest()).put("sha256",seed.sha256());
    }
    synchronized JSONObject prepareTicket(InputStream source,String expectedSha256,SharedSeedFile.Cancellation cancel,SharedSeedFile.Progress progress)throws Exception{
        active();if(seeds.size()>=2)throw bad("SHARED_SEED_STAGING_LIMIT");
        SharedSeedFile.Prepared seed=SharedSeedFile.prepare(source,containers,expectedSha256,cancel,progress);String token=UUID.randomUUID().toString();
        try{JSONObject ticket=seed.manifestTicket().put("seedToken",token).put("sha256",seed.sha256());seeds.put(token,seed);return ticket;}catch(Exception failure){seed.close();throw failure;}
    }
    private static String text(JSONObject q,String key)throws Exception{Object v=q.opt(key);if(!(v instanceof String))throw bad("SHARED_SEED_INVALID_INPUT");return(String)v;}
    private static String token(JSONObject q,String key)throws Exception{String value=text(q,key);if(!value.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw bad("SHARED_SEED_INVALID_HANDLE");return value;}
    private static long number(JSONObject q,String key,long min,long max)throws Exception{return SharedSeedFile.integer(q,key,min,max);}
    private static JSONObject range(byte[] bytes,long offset)throws Exception{return new JSONObject().put("offset",offset).put("next",offset+bytes.length).put("bytesBase64",Base64.getEncoder().encodeToString(bytes)).put("chunkSha256",SharedSeedFile.hex(MessageDigest.getInstance("SHA-256").digest(bytes)));}
    private static JSONObject asset(JSONObject q)throws Exception{
        JSONObject a=q.optJSONObject("asset");if(a==null||!text(a,"assetId").matches("[A-Za-z0-9_-]{1,128}")||!text(a,"sha256").matches("[a-f0-9]{64}")||!(a.opt("mime") instanceof String)||!(a.opt("name") instanceof String))throw bad("SHARED_SEED_INVALID_ASSET");
        number(a,"size",1,16L*1024*1024*1024);if(a.toString().getBytes(StandardCharsets.UTF_8).length>65536)throw bad("SHARED_SEED_INVALID_ASSET");return new JSONObject(a.toString());
    }
    private Stage stage(JSONObject q)throws Exception{Stage s=stages.get(token(q,"token"));if(s==null)throw bad("SHARED_SEED_STAGE_NOT_FOUND");return s;}
    private File original(String handle)throws Exception{
        if(!handle.matches("shared-seed-original:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw bad("SHARED_SEED_INVALID_HANDLE");
        return new File(originals,handle.substring("shared-seed-original:".length()));
    }
    private static JSONObject verifyAttestation(JSONObject q)throws Exception{
        for(Iterator<String> fields=q.keys();fields.hasNext();)if(!Arrays.asList("libraryId","epoch","packageId","watermark","attestation").contains(fields.next()))throw bad("SHARED_SEED_INVALID_ATTESTATION");
        for(String field:new String[]{"libraryId","epoch","packageId"})token(q,field);long watermark=number(q,"watermark",0,9007199254740991L);
        JSONObject a=q.optJSONObject("attestation");SharedSeedFile.validateAttestation(a);
        String message="{\"domain\":\"shiye-shared-seed-attestation-v1\",\"epoch\":"+JSONObject.quote(q.getString("epoch"))+",\"exportId\":"+JSONObject.quote(a.getString("exportId"))+",\"issuedAt\":"+JSONObject.quote(a.getString("issuedAt"))+",\"keyFingerprintSha256\":"+JSONObject.quote(a.getString("keyFingerprintSha256"))+",\"libraryId\":"+JSONObject.quote(q.getString("libraryId"))+",\"manifestPayloadSha256\":"+JSONObject.quote(a.getString("manifestPayloadSha256"))+",\"packageId\":"+JSONObject.quote(q.getString("packageId"))+",\"watermark\":"+watermark+"}";
        byte[] raw=Base64.getDecoder().decode(a.getString("publicKeyRawBase64")),spki=new byte[44],prefix=new byte[]{0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00};System.arraycopy(prefix,0,spki,0,prefix.length);System.arraycopy(raw,0,spki,prefix.length,raw.length);
        try{java.security.Signature verifier=java.security.Signature.getInstance("Ed25519");verifier.initVerify(java.security.KeyFactory.getInstance("Ed25519").generatePublic(new java.security.spec.X509EncodedKeySpec(spki)));verifier.update(message.getBytes(StandardCharsets.UTF_8));return new JSONObject().put("verified",verifier.verify(Base64.getDecoder().decode(a.getString("signatureBase64"))));}
        catch(java.security.NoSuchAlgorithmException unavailable){throw bad("SHARED_SEED_ED25519_UNAVAILABLE");}
    }
    synchronized JSONObject handle(String action,JSONObject q)throws Exception{
        active();if(q==null)q=new JSONObject();
        switch(action){
            case "sharedSeedVerifyAttestation":return verifyAttestation(q);
            case "sharedSeedStorageBudget":{long bytes=number(q,"rawPackageBytes",18,SharedSeedFile.MAX_TRANSFER),required=3L*bytes+128L*1024*1024,available=containers.getUsableSpace();return new JSONObject().put("rawPackageBytes",bytes).put("estimatedAdditionalBytes",required).put("availableBytes",available).put("enough",available>=required).put("estimateOnly",true);}
            case "sharedSeedManifestRead":{SharedSeedFile.Prepared seed=seeds.get(token(q,"seedToken"));if(seed==null)throw bad("SHARED_SEED_NOT_FOUND");long offset=number(q,"offset",0,32L*1024*1024);int length=(int)number(q,"length",1,262144);return range(seed.readManifest(offset,length),offset);}
            case "sharedSeedReadMember":{
                SharedSeedFile.Prepared seed=seeds.get(token(q,"seedToken"));if(seed==null)throw bad("SHARED_SEED_NOT_FOUND");
                long offset=number(q,"offset",0,SharedSeedFile.MAX_BYTES);int length=(int)number(q,"length",1,262144);
                return range(seed.readMember(text(q,"path"),offset,length),offset);
            }
            case "sharedSeedClose":{SharedSeedFile.Prepared seed=seeds.remove(token(q,"seedToken"));if(seed!=null)seed.close();return new JSONObject().put("closed",true);}
            case "sharedSeedOriginalBegin":{
                if(stages.size()>=100000)throw bad("SHARED_SEED_STAGING_LIMIT");
                String token=UUID.randomUUID().toString();Stage s=new Stage(token,asset(q),new File(originals,token+".part"));
                try(FileOutputStream out=new FileOutputStream(s.file)){out.getFD().sync();}stages.put(token,s);return new JSONObject().put("token",token);
            }
            case "sharedSeedOriginalWrite":{
                Stage s=stage(q);long offset=number(q,"offset",0,16L*1024*1024*1024);String encoded=text(q,"bytesBase64");
                if(encoded.length()>349528||!encoded.matches("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?"))throw bad("SHARED_SEED_INVALID_CHUNK");
                byte[] bytes=Base64.getDecoder().decode(encoded);
                if(s.handle!=null||bytes.length<1||bytes.length>262144||offset!=s.next||bytes.length>s.asset.getLong("size")-s.next)throw bad("SHARED_SEED_INVALID_RANGE");
                try(RandomAccessFile out=new RandomAccessFile(s.file,"rw")){out.seek(offset);out.write(bytes);out.getFD().sync();}
                s.digest.update(bytes);s.next+=bytes.length;return new JSONObject().put("next",s.next);
            }
            case "sharedSeedOriginalFinish":{
                Stage s=stage(q);JSONObject a=asset(q);
                for(String field:new String[]{"assetId","sha256","size","mime","name","path"})if(!Objects.equals(s.asset.opt(field),a.opt(field)))throw bad("SHARED_SEED_ASSET_CHANGED");
                if(s.handle!=null)return new JSONObject().put("handle",s.handle);
                if(s.next!=s.asset.getLong("size")||!SharedSeedFile.hex(s.digest.digest()).equals(s.asset.getString("sha256")))throw bad("SHARED_SEED_ORIGINAL_HASH_MISMATCH");
                String handle="shared-seed-original:"+s.token;File target=original(handle),receipt=new File(originals,s.token+".json"),part=new File(originals,s.token+".json.part");
                Files.move(s.file.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);
                try(FileOutputStream out=new FileOutputStream(part)){out.write(s.asset.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
                Files.move(part.toPath(),receipt.toPath(),StandardCopyOption.ATOMIC_MOVE);s.handle=handle;
                return new JSONObject().put("handle",handle);
            }
            case "sharedSeedOriginalAbort":{Stage s=stages.remove(token(q,"token"));if(s!=null){Files.deleteIfExists(s.file.toPath());Files.deleteIfExists(new File(originals,s.token+".json.part").toPath());discard("shared-seed-original:"+s.token);}return new JSONObject().put("aborted",true);}
            case "sharedSeedOriginalRead":{
                String handle=text(q,"handle");File file=original(handle),receipt=new File(originals,file.getName()+".json");
                if(!receipt.isFile()||receipt.length()>65536||!file.isFile())throw bad("SHARED_SEED_ORIGINAL_NOT_FOUND");
                JSONObject a=new JSONObject(new String(Files.readAllBytes(receipt.toPath()),StandardCharsets.UTF_8));
                if(file.length()!=a.getLong("size"))throw bad("SHARED_SEED_ORIGINAL_CHANGED");
                long offset=number(q,"offset",0,file.length());int length=(int)number(q,"length",1,262144);if(length>file.length()-offset)throw bad("SHARED_SEED_INVALID_RANGE");
                byte[] bytes=new byte[length];try(RandomAccessFile in=new RandomAccessFile(file,"r")){in.seek(offset);in.readFully(bytes);}
                return range(bytes,offset).put("size",file.length()).put("sha256",a.getString("sha256")).put("done",offset+length==file.length());
            }
            case "sharedSeedOriginalDiscard":{discard(text(q,"handle"));return new JSONObject().put("discarded",true);}
            default:throw bad("SHARED_SEED_INVALID_ACTION");
        }
    }
    private void discard(String handle)throws Exception{File file=original(handle);Files.deleteIfExists(new File(originals,file.getName()+".json").toPath());Files.deleteIfExists(file.toPath());}
    @Override public synchronized void close(){if(closed)return;closed=true;for(SharedSeedFile.Prepared seed:seeds.values())try{seed.close();}catch(Exception ignored){}seeds.clear();for(Stage stage:stages.values())if(stage.handle==null)try{Files.deleteIfExists(stage.file.toPath());Files.deleteIfExists(new File(originals,stage.token+".json.part").toPath());discard("shared-seed-original:"+stage.token);}catch(Exception ignored){}stages.clear();}
}
