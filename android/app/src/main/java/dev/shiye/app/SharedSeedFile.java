package dev.shiye.app;

import org.json.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;

/** Data backend only: stream and verify a .syseed, optionally inside a ZIP transfer wrapper.
 * No UI, network, database writes, arbitrary extraction paths or whole-media buffers. */
public final class SharedSeedFile {
    public static final long MAX_BYTES=64L*1024*1024*1024, MAX_TRANSFER=MAX_BYTES+64L*1024*1024;
    private static final int MANIFEST_LIMIT=32*1024*1024;
    private static final byte[] MAGIC="SHIYE-SEED-V1\n".getBytes(StandardCharsets.UTF_8);
    public interface Cancellation { boolean cancelled(); }
    public interface Progress { void update(String phase,long completed,long total); }
    public static final class SeedException extends IOException { public final String code;SeedException(String code){super(code);this.code=code;} }
    private static SeedException bad(String code){return new SeedException(code);}
    static void active(Cancellation c)throws Exception{if(Thread.currentThread().isInterrupted()||c!=null&&c.cancelled())throw bad("SEED_CANCELLED");}
    static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    static String hash(File file,Cancellation c)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new BufferedInputStream(new FileInputStream(file))){byte[] bytes=new byte[262144];int n;while((n=in.read(bytes))!=-1){active(c);digest.update(bytes,0,n);}}return hex(digest.digest());}
    private static String utf8(byte[] bytes)throws Exception{try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException e){throw bad("SEED_INVALID_UTF8");}}
    static long integer(JSONObject value,String field,long minimum,long maximum)throws Exception{Object n=value.opt(field);if(!(n instanceof Number))throw bad("SEED_INVALID_INTEGER");double d=((Number)n).doubleValue();long l=((Number)n).longValue();if(!Double.isFinite(d)||d!=l||l<minimum||l>maximum)throw bad("SEED_INVALID_INTEGER");return l;}
    private static String text(JSONObject value,String field)throws Exception{Object s=value.opt(field);if(!(s instanceof String)||((String)s).isEmpty())throw bad("SEED_INVALID_STRING");return(String)s;}
    static void validateManifest(JSONObject m)throws Exception {
        long version=integer(m,"version",1,2);
        if(!"shiye-shared-seed".equals(m.optString("format"))||!"shared-bootstrap".equals(m.optString("mode"))||!Boolean.TRUE.equals(m.opt("complete"))||!Boolean.FALSE.equals(m.opt("containsCredentials"))||!Boolean.FALSE.equals(m.opt("containsSourceArchives")))throw bad("SHARED_SEED_INVALID_MANIFEST");
        JSONArray features=m.optJSONArray("requiredFeatures"),feeds=m.optJSONArray("conversationFeeds");
        boolean signed=false;
        if(version==1&&(m.has("requiredFeatures")||m.has("conversationFeeds")||m.has("attestation")))throw bad("SHARED_SEED_UNSUPPORTED_FEATURE");
        if(version==2){Set<String> known=new HashSet<>();if(features==null||features.length()<1||features.length()>2||feeds==null||feeds.length()>100000)throw bad("SHARED_SEED_UNSUPPORTED_FEATURE");for(int i=0;i<features.length();i++){Object value=features.opt(i);if(!(value instanceof String)||!known.add((String)value)||!"conversation-feeds-v1".equals(value)&&!"seed-attestation-ed25519-v1".equals(value))throw bad("SHARED_SEED_UNSUPPORTED_FEATURE");}if(!known.contains("conversation-feeds-v1"))throw bad("SHARED_SEED_UNSUPPORTED_FEATURE");signed=known.contains("seed-attestation-ed25519-v1");if(signed)validateAttestation(m.optJSONObject("attestation"));else if(m.has("attestation"))throw bad("SHARED_SEED_INVALID_ATTESTATION");}
        for(String field:new String[]{"packageId","libraryId","epoch"})if(!text(m,field).matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw bad("SHARED_SEED_INVALID_MANIFEST");
        long watermark=integer(m,"watermark",0,9007199254740991L);integer(m,"snapshotWatermark",0,watermark);
        JSONObject cursor=m.optJSONObject("cursor");if(cursor==null||!m.getString("libraryId").equals(cursor.optString("libraryId"))||!m.getString("epoch").equals(cursor.optString("epoch"))||integer(cursor,"after",watermark,watermark)!=watermark)throw bad("SHARED_SEED_INVALID_MANIFEST");
        JSONArray members=m.optJSONArray("members"),entities=m.optJSONArray("entities"),assets=m.optJSONArray("assets");
        if(members==null||entities==null||assets==null||members.length()>200000||entities.length()>100000||assets.length()>100000||integer(m,"entityCount",0,100000)!=entities.length()||integer(m,"assetCount",0,100000)!=assets.length())throw bad("SHARED_SEED_INVALID_MANIFEST");
        Map<String,JSONObject> paths=new HashMap<>();long total=0,entityBytes=0;
        for(int n=0;n<members.length();n++){JSONObject member=members.getJSONObject(n);String path=text(member,"path"),sha=text(member,"sha256");boolean entity=path.equals("entities/"+sha+".json");
            if(!sha.matches("[a-f0-9]{64}")||!entity&&!path.equals("media/"+sha)||paths.put(path,member)!=null)throw bad("SHARED_SEED_INVALID_MEMBER");
            long size=integer(member,"size",1,entity?64L*1024*1024:16L*1024*1024*1024);total+=size;if(entity)entityBytes+=size;if(total>MAX_BYTES||entityBytes>512L*1024*1024)throw bad("SHARED_SEED_LIMIT_EXCEEDED");}
        if(total!=integer(m,"bytes",0,MAX_BYTES)||entityBytes!=integer(m,"entityBytes",0,512L*1024*1024))throw bad("SHARED_SEED_LENGTH_MISMATCH");
        Set<String> keys=new HashSet<>(),required=new HashSet<>(),assetIds=new HashSet<>();
        for(int n=0;n<entities.length();n++){JSONObject e=entities.getJSONObject(n);String path=text(e,"path"),type=text(e,"entityType"),id=text(e,"entityId");
            if(!paths.containsKey(path)||!path.startsWith("entities/")||!type.matches("[a-z][a-zA-Z0-9-]{0,63}")||id.length()>256||!text(e,"sha256").matches("[a-f0-9]{64}")||!keys.add(new JSONArray().put(type).put(id).toString()))throw bad("SHARED_SEED_INVALID_ENTITY_DESCRIPTOR");
            integer(e,"revision",1,9007199254740991L);integer(e,"seq",0,watermark);required.add(path);}
        for(int n=0;n<assets.length();n++){JSONObject a=assets.getJSONObject(n);String path=text(a,"path"),id=text(a,"assetId"),sha=text(a,"sha256");JSONObject member=paths.get(path);
            if(member==null||!path.equals("media/"+sha)||!sha.matches("[a-f0-9]{64}")||!id.matches("[A-Za-z0-9_-]{1,128}")||!assetIds.add(id)||!keys.contains(new JSONArray().put("media").put(id).toString())||!(a.opt("mime") instanceof String)||!(a.opt("name") instanceof String)||integer(a,"size",1,16L*1024*1024*1024)!=member.getLong("size"))throw bad("SHARED_SEED_INVALID_ASSET");required.add(path);}
        if(version==2){Set<String> scopes=new HashSet<>(),partsSeen=new HashSet<>();
            for(int n=0;n<feeds.length();n++){JSONObject feed=feeds.getJSONObject(n);String scope=text(feed,"conversationId");JSONArray parts=feed.optJSONArray("parts");
                if(!scope.matches("desktop:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:-?[0-9]{1,20}")||!scopes.add(scope)||!text(feed,"feedRevision").matches("[a-f0-9]{64}")||!text(feed,"rosterSha256").matches("[a-f0-9]{64}")||parts==null||parts.length()>200000)throw bad("SHARED_SEED_INVALID_FEED");
                integer(feed,"watermark",0,watermark);long rows=0,redactions=0;
                for(int p=0;p<parts.length();p++){JSONObject part=parts.getJSONObject(p);String path=text(part,"path"),sha=text(part,"sha256");JSONObject member=paths.get(path);
                    if(member==null||!path.equals("entities/"+sha+".json")||!sha.matches("[a-f0-9]{64}")||!sha.equals(member.optString("sha256"))||integer(part,"size",1,64L*1024*1024)!=member.getLong("size")||required.contains(path)||!partsSeen.add(path))throw bad("SHARED_SEED_INVALID_FEED_PART");
                    rows+=integer(part,"rowCount",0,100000);redactions+=integer(part,"redactionCount",0,100000);required.add(path);
                }
                if(rows!=integer(feed,"rowCount",0,100000)||redactions!=integer(feed,"redactionCount",0,100000))throw bad("SHARED_SEED_INVALID_FEED_PART");
            }
        }
        if(required.size()!=paths.size())throw bad("SHARED_SEED_UNDECLARED_MEMBER");
    }
    static void validateAttestation(JSONObject a)throws Exception{
        if(a==null||integer(a,"version",1,1)!=1||!"Ed25519".equals(a.opt("algorithm"))||!text(a,"exportId").matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")||!text(a,"issuedAt").matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z")||!text(a,"keyFingerprintSha256").matches("[a-f0-9]{64}")||!text(a,"manifestPayloadSha256").matches("[a-f0-9]{64}"))throw bad("SHARED_SEED_INVALID_ATTESTATION");
        for(Iterator<String> fields=a.keys();fields.hasNext();)if(!Arrays.asList("version","algorithm","exportId","issuedAt","publicKeyRawBase64","keyFingerprintSha256","manifestPayloadSha256","signatureBase64").contains(fields.next()))throw bad("SHARED_SEED_INVALID_ATTESTATION");
        byte[] key,signature;try{key=Base64.getDecoder().decode(text(a,"publicKeyRawBase64"));signature=Base64.getDecoder().decode(text(a,"signatureBase64"));}catch(Exception failure){throw bad("SHARED_SEED_INVALID_ATTESTATION");}
        if(key.length!=32||signature.length!=64||!Base64.getEncoder().encodeToString(key).equals(a.getString("publicKeyRawBase64"))||!Base64.getEncoder().encodeToString(signature).equals(a.getString("signatureBase64"))||!hex(MessageDigest.getInstance("SHA-256").digest(key)).equals(a.getString("keyFingerprintSha256")))throw bad("SHARED_SEED_INVALID_ATTESTATION");
    }
    public static final class Prepared implements AutoCloseable {
        private final File root;private final JSONObject manifest;private final Map<String,File> members;private final String sha256;private boolean closed;
        Prepared(File root,JSONObject manifest,Map<String,File> members,String sha){this.root=root;this.manifest=manifest;this.members=members;sha256=sha;}
        public synchronized JSONObject manifest()throws Exception{active();return new JSONObject(manifest.toString());}
        public String sha256(){return sha256;}
        public synchronized JSONObject manifestTicket()throws Exception{active();File file=new File(root,"manifest.json");return new JSONObject().put("packageId",manifest.getString("packageId")).put("libraryId",manifest.getString("libraryId")).put("epoch",manifest.getString("epoch")).put("manifest",new JSONObject().put("byteLength",file.length()).put("sha256",hash(file,null)));}
        public synchronized byte[] readManifest(long offset,int length)throws Exception{active();return range(new File(root,"manifest.json"),offset,length);}
        private void active()throws Exception{if(closed)throw bad("SHARED_SEED_CLOSED");}
        public synchronized byte[] readMember(String path,long offset,int length)throws Exception{
            active();File file=members.get(path);if(file==null)throw bad("SHARED_SEED_MEMBER_NOT_FOUND");
            return range(file,offset,length);
        }
        private byte[] range(File file,long offset,int length)throws Exception{if(offset<0||length<1||length>262144||offset>file.length()||length>file.length()-offset)throw bad("SHARED_SEED_INVALID_RANGE");byte[] bytes=new byte[length];try(RandomAccessFile in=new RandomAccessFile(file,"r")){in.seek(offset);in.readFully(bytes);}return bytes;}
        @Override public synchronized void close()throws IOException{if(closed)return;closed=true;removeTask(root);}
    }
    private static void removeTask(File task)throws IOException{
        try(java.util.stream.Stream<java.nio.file.Path> files=java.nio.file.Files.walk(task.toPath())){
            java.nio.file.Path[] paths=files.sorted(java.util.Comparator.reverseOrder()).toArray(java.nio.file.Path[]::new);
            for(java.nio.file.Path path:paths)java.nio.file.Files.deleteIfExists(path);
        }
    }
    private static byte[] bounded(File file,int limit)throws Exception{if(file.length()>limit)throw bad("SEED_LIMIT_EXCEEDED");try(InputStream in=new FileInputStream(file);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){if(bytes.size()+n>limit)throw bad("SEED_LIMIT_EXCEEDED");bytes.write(buffer,0,n);}return bytes.toByteArray();}}
    private static int u16(byte[] b,int o){return(b[o]&255)|((b[o+1]&255)<<8);}
    private static long u32(byte[] b,int o){return((long)u16(b,o))|((long)u16(b,o+2)<<16);}
    private static long u64(byte[] b,int o)throws Exception{long value=u32(b,o)|(u32(b,o+4)<<32);if(value<0)throw bad("SEED_ZIP_LIMIT_EXCEEDED");return value;}
    /** Bound central-directory cardinality BEFORE ZipFile allocates its entry index. */
    private static void zipDirectory(File file)throws Exception{
        try(RandomAccessFile input=new RandomAccessFile(file,"r")){
            long size=input.length(),start=Math.max(0,size-65557);byte[] tail=new byte[(int)(size-start)];input.seek(start);input.readFully(tail);int end=-1;
            for(int i=tail.length-22;i>=0;i--)if(u32(tail,i)==0x06054b50L&&i+22+u16(tail,i+20)==tail.length){end=i;break;}
            if(end<0||u16(tail,end+4)!=0||u16(tail,end+6)!=0)throw bad("SEED_ZIP_DIRECTORY_INVALID");
            long count=u16(tail,end+10),length=u32(tail,end+12),offset=u32(tail,end+16),directoryEnd=start+end;
            if(count!=u16(tail,end+8))throw bad("SEED_ZIP_DIRECTORY_INVALID");
            if(count==65535||length==0xffffffffL||offset==0xffffffffL){
                long location=start+end-20;if(location<0)throw bad("SEED_ZIP_DIRECTORY_INVALID");byte[] locator=new byte[20];input.seek(location);input.readFully(locator);
                if(u32(locator,0)!=0x07064b50L||u32(locator,4)!=0||u32(locator,16)!=1)throw bad("SEED_ZIP_DIRECTORY_INVALID");long record=u64(locator,8);if(record>size-56)throw bad("SEED_ZIP_DIRECTORY_INVALID");byte[] header=new byte[56];input.seek(record);input.readFully(header);
                if(u32(header,0)!=0x06064b50L||u32(header,16)!=0||u32(header,20)!=0||u64(header,24)!=u64(header,32))throw bad("SEED_ZIP_DIRECTORY_INVALID");count=u64(header,32);length=u64(header,40);offset=u64(header,48);directoryEnd=record;
            }
            if(count<1||count>2||offset>directoryEnd||length!=directoryEnd-offset)throw bad("SEED_ZIP_DIRECTORY_INVALID");
            long cursor=offset,limit=offset+length,actual=0;byte[] entry=new byte[46];
            while(cursor<limit){if(++actual>2||limit-cursor<46)throw bad("SEED_ZIP_DIRECTORY_INVALID");input.seek(cursor);input.readFully(entry);if(u32(entry,0)!=0x02014b50L)throw bad("SEED_ZIP_DIRECTORY_INVALID");long next=cursor+46+u16(entry,28)+u16(entry,30)+u16(entry,32);if(next>limit||next<=cursor)throw bad("SEED_ZIP_DIRECTORY_INVALID");cursor=next;}
            if(actual!=count||cursor!=limit)throw bad("SEED_ZIP_DIRECTORY_INVALID");
        }
    }
    private static void copy(InputStream in,File target,long length,long maximum,Cancellation c,Progress progress,String phase)throws Exception{
        long count=0;try(FileOutputStream out=new FileOutputStream(target)){byte[] bytes=new byte[262144];int n;while((n=in.read(bytes))!=-1){active(c);count+=n;if(count>maximum||length>=0&&count>length)throw bad("SEED_LIMIT_EXCEEDED");out.write(bytes,0,n);if(progress!=null)progress.update(phase,count,length);}if(length>=0&&count!=length)throw bad("SEED_TRUNCATED");out.getFD().sync();}
    }
    public static Prepared prepare(InputStream source,File privateRoot,String expectedSha256,Cancellation cancellation,Progress progress)throws Exception{
        if(source==null||privateRoot==null||!privateRoot.isAbsolute())throw bad("SEED_PRIVATE_DIRECTORY_REQUIRED");
        if(expectedSha256!=null&&!expectedSha256.matches("[a-f0-9]{64}"))throw bad("SEED_INVALID_EXPECTED_HASH");
        if(!privateRoot.isDirectory()&&!privateRoot.mkdirs())throw bad("SEED_PRIVATE_DIRECTORY_REQUIRED");
        File task=new File(privateRoot,UUID.randomUUID().toString());if(!task.mkdir())throw bad("SEED_STAGING_FAILED");
        try{
        File input=new File(task,"input.bin"),seed=new File(task,"data.syseed");
        try(InputStream in=source){copy(in,input,-1,MAX_TRANSFER,cancellation,progress,"receiving");}
        int prefix;try(DataInputStream in=new DataInputStream(new FileInputStream(input))){prefix=in.readInt();}
        if(prefix==0x504b0304||prefix==0x504b0506){
            zipDirectory(input);Set<String> seen=new HashSet<>();try(ZipFile zip=new ZipFile(input)){Enumeration<? extends ZipEntry> entries=zip.entries();while(entries.hasMoreElements()){
                active(cancellation);ZipEntry e=entries.nextElement();String name=e.getName();if(e.isDirectory()||!seen.add(name)||!Arrays.asList("data.syseed","coverage.json").contains(name))throw bad("SEED_ZIP_MEMBER_REJECTED");
                long max=name.equals("data.syseed")?MAX_TRANSFER:1024*1024;if(e.getSize()<0||e.getSize()>max||e.getCrc()<0||e.getMethod()!=ZipEntry.STORED&&e.getMethod()!=ZipEntry.DEFLATED)throw bad("SEED_ZIP_LIMIT_EXCEEDED");
                File target=name.equals("data.syseed")?seed:new File(task,"coverage.json");CRC32 crc=new CRC32();try(InputStream in=new CheckedInputStream(zip.getInputStream(e),crc)){copy(in,target,e.getSize(),max,cancellation,progress,"unpacking");}if(crc.getValue()!=e.getCrc())throw bad("SEED_ZIP_CRC_MISMATCH");
            }}if(!seen.contains("data.syseed"))throw bad("SEED_ZIP_PAYLOAD_MISSING");if(seen.contains("coverage.json"))new JSONObject(utf8(bounded(new File(task,"coverage.json"),1024*1024)));
        }else if(!input.renameTo(seed))throw bad("SEED_STAGING_FAILED");
        String digest=hash(seed,cancellation);if(expectedSha256!=null&&!expectedSha256.equals(digest))throw bad("SEED_PACKAGE_HASH_MISMATCH");
        Map<String,File> files=new LinkedHashMap<>();JSONObject m;
        try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(seed)))){
            byte[] magic=new byte[MAGIC.length];in.readFully(magic);if(!Arrays.equals(magic,MAGIC))throw bad("SEED_MAGIC_MISMATCH");
            long size=((long)in.readInt())&0xffffffffL;if(size<1||size>MANIFEST_LIMIT)throw bad("SEED_MANIFEST_TOO_LARGE");byte[] bytes=new byte[(int)size];in.readFully(bytes);m=new JSONObject(utf8(bytes));validateManifest(m);
            try(FileOutputStream manifestOut=new FileOutputStream(new File(task,"manifest.json"))){manifestOut.write(bytes);manifestOut.getFD().sync();}
            JSONArray members=m.getJSONArray("members");for(int n=0;n<members.length();n++){
                active(cancellation);JSONObject member=members.getJSONObject(n);long length=member.getLong("size");File target=new File(task,"member-"+n);MessageDigest check=MessageDigest.getInstance("SHA-256");
                try(FileOutputStream out=new FileOutputStream(target)){byte[] buffer=new byte[262144];long left=length;while(left>0){active(cancellation);int count=in.read(buffer,0,(int)Math.min(left,buffer.length));if(count<0)throw bad("SEED_TRUNCATED");out.write(buffer,0,count);check.update(buffer,0,count);left-=count;if(progress!=null)progress.update("verifying",length-left,length);}out.getFD().sync();}
                if(!hex(check.digest()).equals(member.getString("sha256")))throw bad("SEED_MEMBER_HASH_MISMATCH");files.put(member.getString("path"),target);
            }if(in.read()!=-1)throw bad("SEED_TRAILING_BYTES");
        }catch(EOFException e){throw bad("SEED_TRUNCATED");}
        return new Prepared(task,m,files,digest);
        }catch(Exception failure){try{removeTask(task);}catch(IOException cleanup){failure.addSuppressed(cleanup);}throw failure;}
    }
}
