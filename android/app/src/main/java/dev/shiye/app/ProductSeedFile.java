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
public final class ProductSeedFile {
    public static final long MAX_BYTES=64L*1024*1024*1024, MAX_TRANSFER=MAX_BYTES+64L*1024*1024;
    private static final int MANIFEST_LIMIT=32*1024*1024,LINE_LIMIT=2*1024*1024;
    private static final byte[] MAGIC="SHIYE-SEED-V1\n".getBytes(StandardCharsets.UTF_8);
    private static final Map<String,String> KINDS=new HashMap<>();
    static {String[][] pairs={{"entry","journalAggregate"},{"message","chatMessage"},{"conversation","conversation"},{"taxonomy","taxonomy"},{"order","order"},{"appearance","appearance"},{"profile","profile"},{"sticker","sticker"},{"commandMapping","commandMapping"},{"media","relation"},{"serviceConfig","serviceConfig"},{"binding","binding"},{"comment","comment"},{"serverState","relation"},{"delivery","relation"}};for(String[]p:pairs)KINDS.put(p[0],p[1]);}
    public interface Cancellation { boolean cancelled(); }
    public interface Progress { void update(String phase,long completed,long total); }
    public interface Visitor { void accept(JSONObject entity)throws Exception; }
    public static final class SeedException extends IOException { public final String code;SeedException(String code){super(code);this.code=code;} }
    private static SeedException bad(String code){return new SeedException(code);}
    static void active(Cancellation c)throws Exception{if(Thread.currentThread().isInterrupted()||c!=null&&c.cancelled())throw bad("SEED_CANCELLED");}
    static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    static String hash(File file,Cancellation c)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new BufferedInputStream(new FileInputStream(file))){byte[] bytes=new byte[262144];int n;while((n=in.read(bytes))!=-1){active(c);digest.update(bytes,0,n);}}return hex(digest.digest());}
    private static String utf8(byte[] bytes)throws Exception{try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}catch(CharacterCodingException e){throw bad("SEED_INVALID_UTF8");}}
    static long integer(JSONObject value,String field,long minimum,long maximum)throws Exception{Object n=value.opt(field);if(!(n instanceof Number))throw bad("SEED_INVALID_INTEGER");double d=((Number)n).doubleValue();long l=((Number)n).longValue();if(!Double.isFinite(d)||d!=l||l<minimum||l>maximum)throw bad("SEED_INVALID_INTEGER");return l;}
    private static String text(JSONObject value,String field)throws Exception{Object s=value.opt(field);if(!(s instanceof String)||((String)s).isEmpty())throw bad("SEED_INVALID_STRING");return(String)s;}
    static void manifest(JSONObject m)throws Exception{
        if(!"shiye-product-seed".equals(m.optString("format"))||integer(m,"version",1,1)!=1||!"product-bootstrap".equals(m.optString("mode"))||!text(m,"packageId").matches("[a-f0-9-]{36}")||!Boolean.FALSE.equals(m.opt("containsCredentials"))||!Boolean.FALSE.equals(m.opt("containsSourceArchives")))throw bad("INVALID_SEED_MANIFEST");
        text(m,"libraryId");text(m,"epoch");text(m,"checkpoint");integer(m,"watermark",0,9007199254740991L);integer(m,"entityCount",0,100000);integer(m,"assetCount",0,100000);
        JSONObject policy=m.optJSONObject("policy");if(policy==null||!"device-local".equals(policy.optString("clientWallpaper"))||!"shared".equals(policy.optString("stickerMetadata")))throw bad("INVALID_SEED_POLICY");
        JSONArray members=m.optJSONArray("members");if(members==null||members.length()<1||members.length()>100001)throw bad("INVALID_SEED_MEMBERS");
        Set<String> paths=new HashSet<>();long total=0;
        for(int i=0;i<members.length();i++){JSONObject item=members.getJSONObject(i);String path=text(item,"path"),sha=text(item,"sha256");if(!sha.matches("[a-f0-9]{64}")||!paths.add(path)||!(i==0?path.equals("records.ndjson"):path.equals("media/"+sha)))throw bad("INVALID_SEED_MEMBER");total+=integer(item,"size",0,i==0?256L*1024*1024:512L*1024*1024);if(total>MAX_BYTES)throw bad("SEED_LIMIT_EXCEEDED");}
        if(total!=integer(m,"bytes",0,MAX_BYTES))throw bad("SEED_LENGTH_MISMATCH");
    }
    static void entity(JSONObject e)throws Exception{
        String type=text(e,"entityType"),id=text(e,"entityId"),state=text(e,"state");integer(e,"revision",1,9007199254740991L);
        if(!id.matches("[A-Za-z0-9_:@.-]{1,160}")||!Arrays.asList("active","deleted","withdrawn").contains(state)||!type.equals("asset")&&!KINDS.containsValue(type))throw bad("INVALID_SEED_ENTITY");
        JSONObject data=e.optJSONObject("data");if(data==null)throw bad("INVALID_SEED_ENTITY");
        if(!state.equals("active")){if(data.length()!=0)throw bad("SEED_WITHDRAWN_BODY");return;}
        if(type.equals("asset")){if(!id.equals(data.optString("assetId"))||!data.optString("sha256").matches("[a-f0-9]{64}"))throw bad("INVALID_SEED_ASSET");integer(data,"size",0,512L*1024*1024);return;}
        JSONObject product=data.optJSONObject("_product"),refs=product==null?null:product.optJSONObject("refs");String kind=product==null?"":product.optString("kind");
        if(product==null||integer(product,"schema",1,1)!=1||!type.equals(KINDS.get(kind))||refs==null)throw bad("INVALID_SEED_PRODUCT");
        if(product.optJSONObject("payload")!=null){JSONObject p=product.getJSONObject("payload");if(!text(p,"assetId").matches("[A-Za-z0-9_:@.-]{1,160}")||!text(p,"sha256").matches("[a-f0-9]{64}"))throw bad("INVALID_SEED_PAYLOAD");integer(p,"size",1,64L*1024*1024);return;}
        for(String name:new String[]{"assets","tags","messages"})if(refs.has(name)){JSONArray ids=refs.optJSONArray(name);if(ids==null)throw bad("INVALID_SEED_REFERENCE");for(int i=0;i<ids.length();i++)if(!(ids.opt(i) instanceof String))throw bad("INVALID_SEED_REFERENCE");}
        if(kind.equals("entry")&&!product.optBoolean("readOnlyProjection")){
            if(!id.equals(data.optString("id")))throw bad("SEED_ENTRY_ID_MISMATCH");
            ProductDiaryStore.validatePrepared(new JSONObject().put("entityType",type).put("entityId",id).put("data",data));
        }
        if(kind.equals("conversation")||kind.equals("message")){
            JSONObject origin=refs.optJSONObject("origin");if(origin==null||!(data.opt("id") instanceof String)||!data.getString("id").matches(kind.equals("conversation")?"-?[0-9]{1,20}":"[0-9]{1,20}"))throw bad("SEED_MESSAGE_ID_MISMATCH");
            String wanted=kind.equals("message")?ProductRepository.productMessageId(origin.getString("sourceId"),origin.getString("roomId"),data.getString("id")):ProductRepository.productConversationId(origin.getString("sourceId"),origin.getString("roomId"));
            if(!wanted.equals(id)||data.has("replyTo")&&!(data.opt("replyTo") instanceof String))throw bad("SEED_MESSAGE_ID_MISMATCH");
            if(kind.equals("message")){try{java.time.OffsetDateTime.parse(data.optString("sentAt",data.optString("eventTime")));}catch(java.time.format.DateTimeParseException invalid){throw bad("SEED_MESSAGE_TIME_INVALID");}}
        }
    }
    public static final class Prepared implements AutoCloseable {
        private final File root,records;private final JSONObject manifest;private final Map<String,File> members;private final Map<String,JSONObject> assets;
        private final String sha256;private final Cancellation cancellation;
        Prepared(File root,File records,JSONObject manifest,Map<String,File> members,Map<String,JSONObject> assets,String hash,Cancellation c){this.root=root;this.records=records;this.manifest=manifest;this.members=members;this.assets=assets;sha256=hash;cancellation=c;}
        public JSONObject manifest()throws Exception{return new JSONObject(manifest.toString());}public String sha256(){return sha256;}public File stagingDirectory(){return root;}
        public void forEach(Visitor visitor)throws Exception{readRows(records,manifest.getJSONArray("members").getJSONObject(0).getString("sha256"),visitor,cancellation);}
        public Map<String,JSONObject> assets()throws Exception{Map<String,JSONObject> copy=new LinkedHashMap<>();for(Map.Entry<String,JSONObject> e:assets.entrySet())copy.put(e.getKey(),new JSONObject(e.getValue().toString()));return copy;}
        public File original(String assetId)throws Exception{JSONObject a=assets.get(assetId);if(a==null)throw bad("SEED_ASSET_NOT_FOUND");return members.get("media/"+a.getString("sha256"));}
        /** Call after import or explicit cancellation; only this generated staging task is removed. */
        @Override public void close()throws IOException{removeTask(root);}
        JSONObject hydrated(JSONObject record)throws Exception{
            if(!"active".equals(record.optString("state"))||record.optJSONObject("data")==null||record.getJSONObject("data").optJSONObject("_product")==null)return record;
            JSONObject product=record.getJSONObject("data").getJSONObject("_product"),payload=product.optJSONObject("payload");if(payload==null)return record;
            JSONObject asset=assets.get(payload.optString("assetId"));File file=asset==null?null:members.get("media/"+asset.optString("sha256"));
            if(file==null||file.length()!=payload.getLong("size")||!asset.getString("sha256").equals(payload.getString("sha256")))throw bad("SEED_PAYLOAD_MISSING");
            byte[] bytes=bounded(file,64*1024*1024);JSONObject data=new JSONObject(utf8(bytes)),p=data.optJSONObject("_product");
            if(p==null||p.has("payload")||!p.optString("kind").equals(product.optString("kind"))||!jsonEqual(p.opt("refs"),product.opt("refs")))throw bad("SEED_PAYLOAD_IDENTITY_MISMATCH");
            JSONObject result=new JSONObject(record.toString());result.put("data",data);entity(result);return result;
        }
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
    static boolean jsonEqual(Object a,Object b)throws Exception{if(a==JSONObject.NULL||a==null)return b==null||b==JSONObject.NULL;if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String>i=x.keys();i.hasNext();){String k=i.next();if(!y.has(k)||!jsonEqual(x.get(k),y.get(k)))return false;}return true;}if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!jsonEqual(x.get(i),y.get(i)))return false;return true;}return a.equals(b);}
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
            long size=((long)in.readInt())&0xffffffffL;if(size<1||size>MANIFEST_LIMIT)throw bad("SEED_MANIFEST_TOO_LARGE");byte[] bytes=new byte[(int)size];in.readFully(bytes);m=new JSONObject(utf8(bytes));manifest(m);
            JSONArray members=m.getJSONArray("members");for(int n=0;n<members.length();n++){
                active(cancellation);JSONObject member=members.getJSONObject(n);long length=member.getLong("size");File target=new File(task,"member-"+n);MessageDigest check=MessageDigest.getInstance("SHA-256");
                try(FileOutputStream out=new FileOutputStream(target)){byte[] buffer=new byte[262144];long left=length;while(left>0){active(cancellation);int count=in.read(buffer,0,(int)Math.min(left,buffer.length));if(count<0)throw bad("SEED_TRUNCATED");out.write(buffer,0,count);check.update(buffer,0,count);left-=count;if(progress!=null)progress.update("verifying",length-left,length);}out.getFD().sync();}
                if(!hex(check.digest()).equals(member.getString("sha256")))throw bad("SEED_MEMBER_HASH_MISMATCH");files.put(member.getString("path"),target);
            }if(in.read()!=-1)throw bad("SEED_TRAILING_BYTES");
        }catch(EOFException e){throw bad("SEED_TRUNCATED");}
        Set<String> keys=new HashSet<>();Map<String,JSONObject> assets=new LinkedHashMap<>();long[] count={0};File records=files.get("records.ndjson");
        readRows(records,m.getJSONArray("members").getJSONObject(0).getString("sha256"),e->{entity(e);String k=e.getString("entityType")+'\0'+e.getString("entityId");if(!keys.add(k))throw bad("SEED_DUPLICATE_ENTITY");count[0]++;if(e.getString("entityType").equals("asset")&&e.getString("state").equals("active"))assets.put(e.getString("entityId"),e.getJSONObject("data"));},cancellation);
        if(count[0]!=m.getLong("entityCount")||assets.size()!=m.getLong("assetCount"))throw bad("SEED_RECORD_COUNT_MISMATCH");
        Set<String> required=new HashSet<>();required.add("records.ndjson");for(JSONObject asset:assets.values()){String name="media/"+asset.getString("sha256");File file=files.get(name);if(file==null||file.length()!=asset.getLong("size"))throw bad("SEED_MEDIA_MISSING");required.add(name);}if(required.size()!=files.size())throw bad("SEED_UNDECLARED_MEDIA");
        Prepared prepared=new Prepared(task,records,m,files,assets,digest,cancellation);
        prepared.forEach(raw->{JSONObject e=prepared.hydrated(raw);if(!e.getString("state").equals("active")||e.getString("entityType").equals("asset"))return;JSONObject refs=e.getJSONObject("data").getJSONObject("_product").getJSONObject("refs");
            for(String name:new String[]{"assets","tags","messages"}){JSONArray ids=refs.optJSONArray(name);if(ids==null)continue;for(int n=0;n<ids.length();n++){String id=ids.getString(n);if(name.equals("assets")?!assets.containsKey(id):!keys.contains((name.equals("tags")?"taxonomy":"chatMessage")+'\0'+id))throw bad("SEED_REFERENCE_MISSING");}}
            if(refs.opt("asset") instanceof String&&!assets.containsKey(refs.getString("asset"))||refs.opt("category") instanceof String&&!keys.contains("taxonomy\0"+refs.getString("category")))throw bad("SEED_REFERENCE_MISSING");
        });return prepared;
        }catch(Exception failure){try{removeTask(task);}catch(IOException cleanup){failure.addSuppressed(cleanup);}throw failure;}
    }
    private static void readRows(File file,String expectedHash,Visitor visitor,Cancellation c)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new BufferedInputStream(new DigestInputStream(new FileInputStream(file),digest))){ByteArrayOutputStream line=new ByteArrayOutputStream();byte[] block=new byte[65536];int n;while((n=in.read(block))!=-1){active(c);for(int i=0;i<n;i++){int b=block[i]&255;if(b==10){if(line.size()==0)throw bad("SEED_EMPTY_RECORD");JSONObject row=new JSONObject(utf8(line.toByteArray()));entity(row);visitor.accept(row);line.reset();}else{if(line.size()>=LINE_LIMIT)throw bad("SEED_RECORD_TOO_LARGE");line.write(b);}}}if(line.size()!=0)throw bad("SEED_RECORD_NOT_TERMINATED");}
        if(!hex(digest.digest()).equals(expectedHash))throw bad("SEED_RECORDS_CHANGED");
    }
}
