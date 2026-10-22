package dev.shiye.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Looper;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLException;

/** Fixed sync/product protocol transport. The caller owns repository transactions and scheduling. */
public final class AndroidSyncTransport implements AutoCloseable {
    private static final Object LOCK = new Object();
    private static final int LIMIT = 256 * 1024;
    private static final int JSON_LIMIT = 32 * 1024 * 1024, BATCH_LIMIT = 4 * 1024 * 1024;
    public static final int MEDIA_CHUNK_LIMIT = 262144;
    public static final long MEDIA_SIZE_LIMIT = 536870912L;
    private final SharedPreferences prefs;
    private final SyncCredentials credentials;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> new Thread(r, "shiye-sync-network"));
    private long cancellation;
    private long verifiedGeneration = -1;
    private boolean connected, closed;
    private final Set<HttpURLConnection> active = new HashSet<>();
    public enum Failure { INVALID_INPUT, MAIN_THREAD, OFFLINE, CANCELLED, AUTH_REQUIRED,
        LIBRARY_MISMATCH, EPOCH_MISMATCH, UNSUPPORTED, INVALID_RESPONSE, STORAGE,
        REDIRECT, TIMEOUT, TLS, NETWORK, TOO_LARGE, FORBIDDEN, CONFLICT, HTTP,
        NOT_FOUND, INVALID_MEDIA, RATE_LIMITED }
    public static final class SyncException extends Exception {
        public final Failure kind; public final int httpStatus;
        public final String remoteCode;
        private SyncException(Failure kind, int status) { this(kind,status,""); }
        private SyncException(Failure kind, int status, String code) { super(message(kind)); this.kind=kind; this.httpStatus=status; this.remoteCode=code; }
    }
    private static String message(Failure kind) {
        switch (kind) {
            case AUTH_REQUIRED: return "同步凭据已失效或尚未配对，请重新配对";
            case LIBRARY_MISMATCH: return "此地址属于另一资料库，原本地资料和库绑定已保留";
            case EPOCH_MISMATCH: return "同步库世代已改变，请先完成恢复方案；原资料已保留";
            case STORAGE: return "同步凭据无法安全保存或读取，请检查系统密钥与存储";
            case CANCELLED: return "连接已取消或配置已改变";
            default: return "同步连接未完成（" + kind.name() + "）";
        }
    }
    private static SyncException fail(Failure kind) { return new SyncException(kind,0); }
    public AndroidSyncTransport(Context context) { this(context, new SyncCredentials()); }
    AndroidSyncTransport(Context context, SyncCredentials credentials) {
        prefs=context.getApplicationContext().getSharedPreferences("sync_connection_v1",Context.MODE_PRIVATE);
        this.credentials=credentials;
    }
    /** All disk, crypto and network operations should be queued here, never on LocalStore's queue. */
    public ExecutorService executor() { return executor; }
    public String getBaseUrl() { synchronized(LOCK) { return prefs.getString("baseUrl",""); } }
    public static String normalizeBaseUrl(String input) throws SyncException {
        String text=input==null?"":input.trim(); if(text.isEmpty())return "";
        try {
            URI uri=new URI(text); String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);
            String host=uri.getHost()==null?"":uri.getHost().toLowerCase(Locale.ROOT);
            if(!scheme.equals("https")&&!scheme.equals("http") || host.isEmpty() || uri.getRawUserInfo()!=null
                || uri.getRawQuery()!=null || uri.getRawFragment()!=null || uri.getPort()==0 || uri.getPort()>65535
                || scheme.equals("http")&&!host.equals("localhost")&&!host.equals("127.0.0.1")&&!host.equals("100.77.215.104"))throw new Exception();
            String path=uri.getRawPath()==null?"":uri.getRawPath();
            // Server's documented path prefixes use simple segments; reject encoded/dot aliases.
            if(!path.matches("(?:/[A-Za-z0-9_-]+)*/?"))throw new Exception();
            while(path.endsWith("/"))path=path.substring(0,path.length()-1);
            int port=uri.getPort(); String authority=host+(port==-1||scheme.equals("https")&&port==443||scheme.equals("http")&&port==80?"":":"+port);
            return scheme+"://"+authority+path;
        } catch(Exception ignored) { throw fail(Failure.INVALID_INPUT); }
    }
    /** Local synchronous commit; changes neither the business address nor the pinned library. */
    public String saveBaseUrl(String value) throws SyncException {
        String base=normalizeBaseUrl(value);
        synchronized(LOCK) {
            if(base.equals(getBaseUrl()))return base;
            if(!prefs.edit().putString("baseUrl",base).putLong("generation",prefs.getLong("generation",0)+1).commit())throw fail(Failure.STORAGE);
            cancelLocked(); return base;
        }
    }
    /** Safe local metadata only. connected means identity verified, never content synchronized. */
    public JSONObject getStatus() throws SyncException {
        synchronized(LOCK) {
            try { return new JSONObject().put("baseUrl",getBaseUrl()).put("connected",connected&&!closed&&verifiedGeneration==prefs.getLong("generation",0)
                    &&!prefs.getString(SyncCredentials.key(getBaseUrl()),"").isEmpty())
                .put("contentSyncEnabled",false).put("libraryId",prefs.getString("libraryId",""))
                .put("epoch",prefs.getString("epoch","")).put("deviceId",prefs.getString(SyncCredentials.key(getBaseUrl())+".deviceId",""))
                .put("paired",!prefs.getString(SyncCredentials.key(getBaseUrl()),"").isEmpty())
                .put("hasCredentials",!prefs.getString(SyncCredentials.key(getBaseUrl()),"").isEmpty());
            } catch(Exception ignored) { throw fail(Failure.STORAGE); }
        }
    }
    private static final class Session {
        String base; long generation, cancellation;
    }
    private Session session() throws SyncException {
        if(Looper.myLooper()==Looper.getMainLooper())throw fail(Failure.MAIN_THREAD);
        synchronized(LOCK) {
            if(closed)throw fail(Failure.CANCELLED);
            Session s=new Session();s.base=getBaseUrl();s.generation=prefs.getLong("generation",0);s.cancellation=cancellation;
            if(s.base.isEmpty())throw fail(Failure.OFFLINE);return s;
        }
    }
    private void current(Session s) throws SyncException {
        if(closed||s.cancellation!=cancellation||s.generation!=prefs.getLong("generation",0)||!s.base.equals(getBaseUrl()))throw fail(Failure.CANCELLED);
    }
    public JSONObject health() throws SyncException { Session s=session(); return health(s); }
    private JSONObject health(Session s) throws SyncException {
        JSONObject h=request(s,"health",null,null);
        if(!"shiye-sync".equals(h.opt("service"))||!one(h.opt("protocol")))throw fail(Failure.UNSUPPORTED);
        return h;
    }
    /** Pairing code is supplied explicitly; never requests a server-local pairing code. */
    public JSONObject pair(String code,String deviceName) throws SyncException {
        Session s=session();
        synchronized(LOCK){current(s);connected=false;}
        if(code==null||!code.matches("[0-9]{8}")||deviceName==null||deviceName.length()>80||deviceName.trim().isEmpty())throw fail(Failure.INVALID_INPUT);
        health(s);
        try {
            JSONObject pair=request(s,"pair",new JSONObject().put("code",code).put("deviceName",deviceName.trim()),null);
            if(!uuid(pair.optString("deviceId"))||!pair.optString("token").matches("[a-f0-9]{64}")||!deviceName.trim().equals(pair.optString("deviceName")))throw fail(Failure.INVALID_RESPONSE);
            // Store only the credential contract, never arbitrary response extensions.
            pair=new JSONObject().put("deviceId",pair.getString("deviceId")).put("token",pair.getString("token"))
                .put("deviceName",pair.getString("deviceName"));
            JSONObject info=request(s,"info",null,pair);validateInfo(info,pair);
            synchronized(LOCK) {
                current(s);guard(info);
                String encrypted=credentials.encrypt(s.base,pair.toString());
                current(s);
                if(!prefs.edit().putString(SyncCredentials.key(s.base),encrypted).putString(SyncCredentials.key(s.base)+".deviceId",pair.getString("deviceId")).putString("libraryId",info.getString("libraryId"))
                    .putString("epoch",info.getString("epoch")).commit())throw fail(Failure.STORAGE);
                connected=true;verifiedGeneration=s.generation;
            }
            return info;
        } catch(SyncException e) { throw e; } catch(Exception ignored) { throw fail(Failure.STORAGE); }
    }
    public JSONObject connect() throws SyncException { return readInfo(); }
    public JSONObject readInfo() throws SyncException {
        Session s=session();JSONObject credential;
        synchronized(LOCK){current(s);connected=false;}
        try {
            synchronized(LOCK) {
                current(s);String encrypted=prefs.getString(SyncCredentials.key(s.base),"");
                if(encrypted.isEmpty())throw fail(Failure.AUTH_REQUIRED);
                credential=new JSONObject(credentials.decrypt(s.base,encrypted));
                if(!uuid(credential.optString("deviceId"))||!credential.optString("token").matches("[a-f0-9]{64}"))throw fail(Failure.STORAGE);
            }
        } catch(SyncException e) {throw e;} catch(Exception ignored) {throw fail(Failure.STORAGE);}
        health(s);JSONObject info=request(s,"info",null,credential);validateInfo(info,credential);
        synchronized(LOCK) {current(s);guard(info);connected=true;verifiedGeneration=s.generation;}return info;
    }
    private void guard(JSONObject info) throws SyncException {
        String library=prefs.getString("libraryId","");String epoch=prefs.getString("epoch","");
        if(!library.isEmpty()&&!library.equals(info.optString("libraryId"))){connected=false;throw fail(Failure.LIBRARY_MISMATCH);}
        if(!epoch.isEmpty()&&!epoch.equals(info.optString("epoch"))){connected=false;throw fail(Failure.EPOCH_MISMATCH);}
    }
    private static boolean uuid(String s) { return s.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}"); }
    private static boolean one(Object x) {return x instanceof Number&&((Number)x).doubleValue()==1;}
    private static void validateInfo(JSONObject info,JSONObject credential) throws SyncException {
        Object seq=info.opt("seq");
        if(!one(info.opt("protocol"))||!uuid(info.optString("libraryId"))||!uuid(info.optString("epoch"))
            ||!credential.optString("deviceId").equals(info.opt("deviceId"))||!(seq instanceof Number)
            ||((Number)seq).doubleValue()<0||((Number)seq).doubleValue()>9007199254740991d
            ||((Number)seq).doubleValue()!=Math.floor(((Number)seq).doubleValue())||!(info.opt("cursor") instanceof String))throw fail(Failure.INVALID_RESPONSE);
    }
    private JSONObject credential(Session s) throws SyncException {
        try { synchronized(LOCK) {
            current(s);String raw=prefs.getString(SyncCredentials.key(s.base),"");
            if(raw.isEmpty())throw fail(Failure.AUTH_REQUIRED);
            JSONObject value=new JSONObject(credentials.decrypt(s.base,raw));
            if(!uuid(value.optString("deviceId"))||!value.optString("token").matches("[a-f0-9]{64}"))throw fail(Failure.STORAGE);
            return value;
        }}catch(SyncException e){throw e;}catch(Exception ignored){throw fail(Failure.STORAGE);}
    }
    private static final class Authorized { Session session; JSONObject credential; }
    private Authorized authorize(boolean product) throws SyncException {
        Authorized a=new Authorized();a.session=session();a.credential=credential(a.session);
        synchronized(LOCK){current(a.session);connected=false;}
        JSONObject info=request(a.session,"info",null,a.credential);validateInfo(info,a.credential);
        synchronized(LOCK){current(a.session);
            if(!uuid(prefs.getString("libraryId",""))||!uuid(prefs.getString("epoch","")))throw fail(Failure.STORAGE);
            guard(info);}
        if(product) {
            JSONObject features=info.optJSONObject("features");JSONObject capability=features==null?null:features.optJSONObject("product");
            if(capability==null||!one(capability.opt("schema")))throw fail(Failure.UNSUPPORTED);
        }
        synchronized(LOCK){current(a.session);connected=true;verifiedGeneration=a.session.generation;}
        return a;
    }
    private static JSONObject copy(JSONObject input) throws SyncException {
        if(input==null)throw fail(Failure.INVALID_INPUT);
        try{return new JSONObject(input.toString());}catch(Exception ignored){throw fail(Failure.INVALID_INPUT);}
    }
    private static String query(String value) throws SyncException {
        if(value==null||value.length()>16384)throw fail(Failure.INVALID_INPUT);
        try{return URLEncoder.encode(value,"UTF-8");}catch(Exception ignored){throw fail(Failure.INVALID_INPUT);}
    }
    private static void identifier(String id) throws SyncException {
        if(id==null||!id.matches("[A-Za-z0-9_:@.-]{1,200}")||id.equals(".")||id.equals(".."))throw fail(Failure.INVALID_INPUT);
    }
    private static void mediaId(String id) throws SyncException {
        if(id==null||!id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw fail(Failure.INVALID_INPUT);
    }
    private static void textId(JSONObject value,String key,boolean decimal) throws SyncException {
        Object id=value.opt(key);
        if(!(id instanceof String)||((String)id).isEmpty()||((String)id).length()>200
            ||decimal&&!((String)id).matches("-?[0-9]+"))throw fail(Failure.INVALID_INPUT);
    }
    private JSONObject product(String method,String route,JSONObject input) throws SyncException {
        Authorized a=authorize(true);
        return json(a.session,method,"api/product/v1/"+route,input,a.credential,
            route.equals("chat/send")||route.equals("revisit/comments")?950000:BATCH_LIMIT,JSON_LIMIT,30000);
    }
    public JSONObject catalog() throws SyncException {
        JSONObject result=product("GET","catalog",null);
        synchronized(LOCK){guard(result);}
        if(!one(result.opt("schema"))||!uuid(result.optString("libraryId"))||!uuid(result.optString("epoch"))
            ||!(result.opt("types") instanceof JSONArray)||!(result.opt("readOnlyKinds") instanceof JSONArray))throw fail(Failure.INVALID_RESPONSE);
        return result;
    }
    /** Full compatibility view; page-based snapshot/pull are the normal receive path. */
    public JSONObject library() throws SyncException {return product("GET","library",null);}
    /** Fixed seed endpoints; local file import is owned by ProductSeedInstaller, not this HTTP API. */
    public JSONObject seedCreateExport(String operationId)throws SyncException{
        if(operationId==null||!operationId.matches("[A-Za-z0-9_:@.-]{1,160}"))throw fail(Failure.INVALID_INPUT);
        try{return product("POST","seed/exports",new JSONObject().put("operationId",operationId));}catch(SyncException e){throw e;}catch(Exception e){throw fail(Failure.INVALID_INPUT);}
    }
    public JSONObject seedExport(String id)throws SyncException{if(id==null||!uuid(id))throw fail(Failure.INVALID_INPUT);return product("GET","seed/exports/"+id,null);}
    public JSONObject seedResolve(JSONObject input)throws SyncException{
        try{JSONObject value=new JSONObject();for(String field:new String[]{"packageId","sha256","libraryId","epoch","checkpoint"}){Object item=input.opt(field);if(!(item instanceof String)||((String)item).isEmpty())throw fail(Failure.INVALID_INPUT);value.put(field,item);}
            if(!uuid(value.getString("packageId"))||!value.getString("sha256").matches("[a-f0-9]{64}"))throw fail(Failure.INVALID_INPUT);
            return product("POST","seed/resolve",value);
        }catch(SyncException e){throw e;}catch(Exception e){throw fail(Failure.INVALID_INPUT);}
    }
    public MediaChunk seedReadChunk(String id,long offset,int length,long expectedSize)throws SyncException{
        if(id==null||!uuid(id)||expectedSize<1||expectedSize>64L*1024*1024*1024+64L*1024*1024||offset<0||offset>=expectedSize||length<1||length>MEDIA_CHUNK_LIMIT)throw fail(Failure.INVALID_INPUT);
        long end=Math.min(expectedSize-1,offset+length-1);Authorized a=authorize(false);
        Exchange result=exchange(a.session,"GET","api/product/v1/seed/exports/"+id+"/content",null,a.credential,null,null,"bytes="+offset+"-"+end,MEDIA_CHUNK_LIMIT,30000);
        if(result.status!=206||!("bytes "+offset+"-"+end+"/"+expectedSize).equals(result.contentRange)||result.bytes.length!=end-offset+1)throw fail(Failure.INVALID_RESPONSE);
        return new MediaChunk(result.bytes,offset,expectedSize,result.mime);
    }
    public JSONObject saveRoom(JSONObject input) throws SyncException {
        JSONObject value=copy(input);textId(value,"sourceId",false);textId(value,"id",true);
        if(!uuid(value.optString("sourceId")))throw fail(Failure.INVALID_INPUT);
        return product("POST","chat/room",value);
    }
    public JSONObject sendMessages(JSONObject input) throws SyncException {
        JSONObject value=copy(input);textId(value,"sourceId",false);textId(value,"roomId",true);
        if(!uuid(value.optString("sourceId")))throw fail(Failure.INVALID_INPUT);
        JSONArray messages=value.optJSONArray("messages");if(messages==null||messages.length()==0)throw fail(Failure.INVALID_INPUT);
        for(int i=0;i<messages.length();i++){
            JSONObject m=messages.optJSONObject(i);if(m==null)throw fail(Failure.INVALID_INPUT);textId(m,"id",true);
            if(m.has("replyTo")&&!m.isNull("replyTo"))textId(m,"replyTo",true);
        }
        return product("POST","chat/send",value);
    }
    public JSONObject withdrawMessage(JSONObject input) throws SyncException {
        JSONObject value=copy(input);textId(value,"sourceId",false);textId(value,"roomId",true);textId(value,"messageId",true);
        if(!uuid(value.optString("sourceId")))throw fail(Failure.INVALID_INPUT);
        return product("POST","chat/withdraw",value);
    }
    public JSONObject revisitStatus() throws SyncException {return product("GET","revisit",null);}
    public JSONObject configureRevisit(JSONObject input) throws SyncException {
        JSONObject value=copy(input);if(!safeInteger(value.opt("expectedRevision"),0,9007199254740991d))throw fail(Failure.INVALID_INPUT);
        return product("PUT","revisit/config",value);
    }
    public JSONObject tickRevisit(JSONObject input) throws SyncException {return product("POST","revisit/tick",copy(input));}
    public JSONObject revisitFeed(JSONObject input) throws SyncException {return product("POST","revisit/feed",copy(input));}
    public JSONObject commentContext(JSONObject input) throws SyncException {return product("POST","revisit/comments/context",copy(input));}
    public JSONObject addComment(JSONObject input) throws SyncException {
        JSONObject value=copy(input);textId(value,"operationId",false);return product("POST","revisit/comments",value);
    }
    public JSONObject withdrawComment(JSONObject input) throws SyncException {
        JSONObject value=copy(input);textId(value,"operationId",false);return product("POST","revisit/comments/withdraw",value);
    }
    public JSONObject commentsForEntry(String entryId) throws SyncException {
        if(entryId==null||entryId.isEmpty()||entryId.length()>200)throw fail(Failure.INVALID_INPUT);
        return product("GET","revisit/comments?entryId="+query(entryId),null);
    }
    public JSONObject revisitSource(JSONObject input) throws SyncException {return product("POST","revisit/source",copy(input));}
    private static boolean safeInteger(Object n,double min,double max) {
        if(!(n instanceof Number))return false;double d=((Number)n).doubleValue();return d>=min&&d<=max&&d==Math.floor(d);
    }
    private JSONObject page(String endpoint,String cursor,int limit) throws SyncException {
        if(limit<1||limit>200||cursor!=null&&cursor.length()>16384)throw fail(Failure.INVALID_INPUT);
        try {
            JSONObject value=new JSONObject().put("limit",limit);if(cursor!=null&&!cursor.isEmpty())value.put("cursor",cursor);
            Authorized a=authorize(false);
            JSONObject result=json(a.session,"POST","api/sync/v1/"+endpoint,value,a.credential,16384,JSON_LIMIT,30000);
            if(!(result.opt(endpoint.equals("snapshot")?"entities":"changes") instanceof JSONArray)
                ||!(result.opt("cursor") instanceof String)||!(result.opt("hasMore") instanceof Boolean)
                ||endpoint.equals("snapshot")&&!(result.opt("checkpoint") instanceof String))throw fail(Failure.INVALID_RESPONSE);
            return result;
        }catch(SyncException e){throw e;}catch(Exception ignored){throw fail(Failure.INVALID_INPUT);}
    }
    /** Never persists or advances a cursor. Repository must commit the whole page atomically. */
    public JSONObject snapshot(String cursor,int limit) throws SyncException {return page("snapshot",cursor,limit);}
    public JSONObject pull(String cursor,int limit) throws SyncException {return page("pull",cursor,limit);}
    public JSONObject push(JSONArray operations) throws SyncException {
        if(operations==null||operations.length()<1||operations.length()>100)throw fail(Failure.INVALID_INPUT);
        try {
            JSONArray fixed=new JSONArray(operations.toString());
            for(int i=0;i<fixed.length();i++){
                JSONObject op=fixed.optJSONObject(i);if(op==null)throw fail(Failure.INVALID_INPUT);
                if(op.toString().getBytes(StandardCharsets.UTF_8).length>1048576)throw fail(Failure.TOO_LARGE);
                textId(op,"operationId",false);textId(op,"entityType",false);textId(op,"entityId",false);
                if(!safeInteger(op.opt("baseRevision"),0,9007199254740991d))throw fail(Failure.INVALID_INPUT);
            }
            JSONObject input=new JSONObject().put("operations",fixed);Authorized a=authorize(false);
            return json(a.session,"POST","api/sync/v1/push",input,a.credential,BATCH_LIMIT,JSON_LIMIT,30000);
        }catch(SyncException e){throw e;}catch(Exception ignored){throw fail(Failure.INVALID_INPUT);}
    }
    /** One explicit long poll, no loop or automatic pull. */
    public JSONObject watch(String cursor,int timeoutMs) throws SyncException {
        if(timeoutMs<100||timeoutMs>30000)throw fail(Failure.INVALID_INPUT);
        String route="api/sync/v1/watch?timeout="+timeoutMs+(cursor==null||cursor.isEmpty()?"":"&cursor="+query(cursor));
        Authorized a=authorize(false);return json(a.session,"GET",route,null,a.credential,0,LIMIT,timeoutMs+10000);
    }
    public JSONObject listConflicts(String entityType,String entityId) throws SyncException {
        String route="api/sync/v1/conflicts";if(entityType!=null){identifier(entityType);route+="?entityType="+query(entityType);}
        if(entityId!=null){identifier(entityId);route+=(entityType==null?"?":"&")+"entityId="+query(entityId);}
        Authorized a=authorize(false);return json(a.session,"GET",route,null,a.credential,0,JSON_LIMIT,30000);
    }
    public JSONObject getConflict(String conflictId) throws SyncException {
        identifier(conflictId);Authorized a=authorize(false);return json(a.session,"GET","api/sync/v1/conflicts/"+conflictId,null,a.credential,0,JSON_LIMIT,30000);
    }
    private static void mediaMetadata(JSONObject value) throws SyncException {
        mediaId(value.optString("assetId"));
        if(!safeInteger(value.opt("size"),1,MEDIA_SIZE_LIMIT)||!value.optString("sha256").matches("[a-f0-9]{64}")
            ||!(value.opt("mime") instanceof String)||!value.optString("mime").matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")
            ||value.optString("mime").length()>200)throw fail(Failure.INVALID_MEDIA);
    }
    public JSONObject mediaBegin(JSONObject input) throws SyncException {
        JSONObject fixed=copy(input);mediaMetadata(fixed);Authorized a=authorize(false);
        JSONObject result=json(a.session,"POST","api/sync/v1/media/uploads",fixed,a.credential,4096,LIMIT,30000);
        mediaMetadata(result);verifyOriginal(result,fixed.optString("assetId"),fixed.optLong("size"),fixed.optString("sha256"));return result;
    }
    public JSONObject mediaUploadStatus(String uploadId) throws SyncException {
        mediaId(uploadId);Authorized a=authorize(false);JSONObject result=json(a.session,"GET","api/sync/v1/media/uploads/"+uploadId,null,a.credential,0,LIMIT,30000);mediaMetadata(result);
        if(!uploadId.equals(result.optString("uploadId")))throw fail(Failure.INVALID_RESPONSE);return result;
    }
    public JSONObject mediaPutChunk(String uploadId,int index,byte[] bytes) throws SyncException {
        mediaId(uploadId);if(index<0||index>=2048||bytes==null||bytes.length<1||bytes.length>MEDIA_CHUNK_LIMIT)throw fail(Failure.INVALID_INPUT);
        byte[] fixed=bytes.clone();Authorized a=authorize(false);
        Exchange response=exchange(a.session,"PUT","api/sync/v1/media/uploads/"+uploadId+"/chunks/"+index,fixed,a.credential,
            "application/octet-stream",sha256(fixed),null,LIMIT,30000);
        return parse(response.bytes);
    }
    public JSONObject mediaComplete(String uploadId,String assetId,long size,String sha256) throws SyncException {
        mediaId(uploadId);mediaId(assetId);if(size<1||size>MEDIA_SIZE_LIMIT||sha256==null||!sha256.matches("[a-f0-9]{64}"))throw fail(Failure.INVALID_INPUT);
        Authorized a=authorize(false);JSONObject result=json(a.session,"POST","api/sync/v1/media/uploads/"+uploadId+"/complete",new JSONObject(),a.credential,4096,LIMIT,30000);
        mediaMetadata(result);verifyOriginal(result,assetId,size,sha256);if(!Boolean.TRUE.equals(result.opt("available")))throw fail(Failure.INVALID_MEDIA);return result;
    }
    public JSONObject mediaAsset(String assetId) throws SyncException {
        mediaId(assetId);Authorized a=authorize(false);JSONObject result=json(a.session,"GET","api/sync/v1/media/assets/"+assetId,null,a.credential,0,LIMIT,30000);
        mediaMetadata(result);if(!assetId.equals(result.optString("assetId")))throw fail(Failure.INVALID_RESPONSE);return result;
    }
    private static void verifyOriginal(JSONObject result,String assetId,long size,String hash) throws SyncException {
        if(!assetId.equals(result.optString("assetId"))||size!=result.optLong("size")||!hash.equals(result.optString("sha256")))throw fail(Failure.INVALID_MEDIA);
    }
    public static final class MediaChunk {
        public final byte[] bytes;public final long offset,total;public final String mime;
        private MediaChunk(byte[] bytes,long offset,long total,String mime){this.bytes=bytes;this.offset=offset;this.total=total;this.mime=mime;}
    }
    /** Raw original bytes only. Caller hashes assembled private file against mediaAsset.sha256. */
    public MediaChunk mediaReadChunk(String assetId,long offset,int length,long expectedSize) throws SyncException {
        mediaId(assetId);if(expectedSize<1||expectedSize>MEDIA_SIZE_LIMIT||offset<0||offset>=expectedSize||length<1||length>MEDIA_CHUNK_LIMIT)throw fail(Failure.INVALID_INPUT);
        long end=Math.min(expectedSize-1,offset+length-1);Authorized a=authorize(false);
        Exchange result=exchange(a.session,"GET","api/sync/v1/media/assets/"+assetId+"/content",null,a.credential,null,null,"bytes="+offset+"-"+end,MEDIA_CHUNK_LIMIT,30000);
        if(result.status!=206||!("bytes "+offset+"-"+end+"/"+expectedSize).equals(result.contentRange)||result.bytes.length!=end-offset+1)throw fail(Failure.INVALID_MEDIA);
        return new MediaChunk(result.bytes,offset,expectedSize,result.mime);
    }
    public static String sha256(byte[] bytes) throws SyncException {
        try{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
        catch(Exception ignored){throw fail(Failure.INVALID_INPUT);}
    }
    private JSONObject request(Session s,String endpoint,JSONObject body,JSONObject credential) throws SyncException {
        JSONObject result=json(s,body==null?"GET":"POST","api/sync/v1/"+endpoint,body,credential,2048,LIMIT,12000);
        if(!endpoint.equals("pair")&&(result.has("token")||result.has("code")||result.has("authorization")))throw fail(Failure.INVALID_RESPONSE);
        return result;
    }
    private static JSONObject parse(byte[] bytes) throws SyncException {
        try{return new JSONObject(new String(bytes,StandardCharsets.UTF_8));}catch(Exception ignored){throw fail(Failure.INVALID_RESPONSE);}
    }
    private JSONObject json(Session s,String method,String route,JSONObject body,JSONObject credential,int requestLimit,int responseLimit,int timeout) throws SyncException {
        byte[] bytes=body==null?null:body.toString().getBytes(StandardCharsets.UTF_8);
        if(bytes!=null&&bytes.length>requestLimit)throw fail(Failure.TOO_LARGE);
        return parse(exchange(s,method,route,bytes,credential,"application/json; charset=utf-8",null,null,responseLimit,timeout).bytes);
    }
    private static final class Exchange {
        byte[] bytes;int status;String contentRange,mime;
    }
    private Exchange exchange(Session s,String method,String route,byte[] body,JSONObject credential,String contentType,String chunkHash,String range,int responseLimit,int timeout) throws SyncException {
        HttpURLConnection connection=null;
        try {
            synchronized(LOCK) {
                current(s);connection=(HttpURLConnection)new URI(s.base+"/"+route).toURL().openConnection();active.add(connection);
            }
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(timeout);
            connection.setUseCaches(false);connection.setRequestProperty("Accept","application/json");
            connection.setRequestMethod(method);
            if(credential!=null) {connection.setRequestProperty("Authorization","Bearer "+credential.getString("token"));connection.setRequestProperty("X-Sync-Device-Id",credential.getString("deviceId"));}
            if(chunkHash!=null)connection.setRequestProperty("X-Chunk-Sha256",chunkHash);
            if(range!=null)connection.setRequestProperty("Range",range);
            if(body!=null) {
                connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);
                connection.setRequestProperty("Content-Type",contentType);
                try(java.io.OutputStream output=connection.getOutputStream()){output.write(body);}
            }
            int status=connection.getResponseCode();synchronized(LOCK){current(s);}
            if(status>=300&&status<400)throw new SyncException(Failure.REDIRECT,status);
            if(status==401) {
                synchronized(LOCK) {
                    current(s);connected=false;
                    // Invalid pairing codes must not erase a previously valid device credential.
                    if(credential!=null) {
                        String raw=prefs.getString(SyncCredentials.key(s.base),"");
                        // A late revoked-token response must not erase a newer successful pairing.
                        boolean same=false;
                        try{same=!raw.isEmpty()&&new JSONObject(credentials.decrypt(s.base,raw)).optString("token").equals(credential.optString("token"));}catch(Exception ignored){}
                        if(same&&!prefs.edit().putString(SyncCredentials.key(s.base),"").commit())throw fail(Failure.STORAGE);
                    }
                }
                throw new SyncException(Failure.AUTH_REQUIRED,status);
            }
            if(status<200||status>=300) {
                Failure kind=status==403?Failure.FORBIDDEN:status==409?Failure.CONFLICT:status==404?Failure.NOT_FOUND:
                    status==413?Failure.TOO_LARGE:status==422?Failure.INVALID_MEDIA:status==429?Failure.RATE_LIMITED:Failure.HTTP;
                String code="";
                // Only a constrained machine code, never server messages/body/cause, leaves this boundary.
                try(InputStream errors=connection.getErrorStream()) {
                    if(errors!=null){byte[] buffer=new byte[4097];int count=0,n;while(count<buffer.length&&(n=errors.read(buffer,count,buffer.length-count))>0)count+=n;
                        if(count<=4096){JSONObject error=parse(Arrays.copyOf(buffer,count)).optJSONObject("error");String candidate=error==null?"":error.optString("code");
                            if(candidate.matches("[A-Z][A-Z0-9_]{0,59}")||new HashSet<>(Arrays.asList("missing-chunks","hash-mismatch","asset-conflict","original-corrupt","invalid-size","invalid-range")).contains(candidate))code=candidate;}
                    }
                }catch(Exception ignored){}
                synchronized(LOCK){current(s);}throw new SyncException(kind,status,code);
            }
            if(connection.getContentLengthLong()>responseLimit)throw fail(Failure.TOO_LARGE);
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            try(InputStream stream=connection.getInputStream()) {
                byte[] buffer=new byte[8192];int count;
                while((count=stream.read(buffer))!=-1) {if(output.size()+count>responseLimit)throw fail(Failure.TOO_LARGE);output.write(buffer,0,count);synchronized(LOCK){current(s);}}
            }
            Exchange result=new Exchange();result.bytes=output.toByteArray();result.status=status;
            result.contentRange=connection.getHeaderField("Content-Range");result.mime=connection.getContentType();
            synchronized(LOCK){current(s);}return result;
        } catch(SyncException e){throw e;} catch(SocketTimeoutException ignored){synchronized(LOCK){current(s);}throw fail(Failure.TIMEOUT);}
        catch(SSLException ignored){synchronized(LOCK){current(s);}throw fail(Failure.TLS);} catch(Exception ignored){synchronized(LOCK){current(s);}throw fail(Failure.NETWORK);}
        finally {if(connection!=null)connection.disconnect();synchronized(LOCK){active.remove(connection);}}
    }
    private void cancelLocked() {cancellation++;connected=false;for(HttpURLConnection connection:active)connection.disconnect();}
    public void cancel() {synchronized(LOCK){cancelLocked();}}
    /** Stops the current session; retains encrypted pairing and library guard for explicit reconnect. */
    public void disconnect() {cancel();}
    public void close() {synchronized(LOCK){closed=true;cancelLocked();}executor.shutdownNow();}
}
