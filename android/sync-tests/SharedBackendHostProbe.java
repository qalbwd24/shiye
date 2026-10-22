package dev.shiye.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.*;
import java.nio.file.*;
import java.util.*;
import java.io.*;

/** Actual Java transport against real synthetic HTTP; only Android preference/looper ports are replaced. */
public final class SharedBackendHostProbe {
    private static final JSONArray checks=new JSONArray();
    private static void check(String name,boolean ok){if(!ok)throw new AssertionError(name);checks.put(name);}
    static final class HostContext extends Context {
        final Path root; final Map<String,SharedPreferences> cache=new HashMap<>();
        HostContext(Path root)throws Exception{this.root=root;Files.createDirectories(root);}
        public SharedPreferences getSharedPreferences(String name,int mode){return cache.computeIfAbsent(name,n->new Prefs(root.resolve(n+".properties")));}
    }
    static final class Prefs implements SharedPreferences {
        final Path file; Properties values=new Properties();
        Prefs(Path file){this.file=file;try(InputStream in=Files.newInputStream(file)){values.load(in);}catch(NoSuchFileException ignored){}catch(Exception e){throw new IllegalStateException(e);}}
        public String getString(String key,String fallback){return values.getProperty(key,fallback);}
        public long getLong(String key,long fallback){return Long.parseLong(values.getProperty(key,Long.toString(fallback)));}
        public Editor edit(){return new Editor(){final Map<String,String> changes=new LinkedHashMap<>();
            public Editor putString(String k,String v){changes.put(k,v);return this;} public Editor putLong(String k,long v){return putString(k,Long.toString(v));}public Editor remove(String k){changes.put(k,null);return this;}
            public boolean commit(){try{Properties next=new Properties();next.putAll(values);for(Map.Entry<String,String> c:changes.entrySet()){if(c.getValue()==null)next.remove(c.getKey());else next.setProperty(c.getKey(),c.getValue());}Path part=file.resolveSibling(file.getFileName()+".part");try(OutputStream out=Files.newOutputStream(part)){next.store(out,"synthetic native preferences");}Files.move(part,file,StandardCopyOption.REPLACE_EXISTING);values=next;return true;}catch(Exception e){return false;}}
        };}
    }
    public static void main(String[] args)throws Exception{
        JSONObject fixture=new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])),java.nio.charset.StandardCharsets.UTF_8));
        BackendServices backend=new BackendServices(new HostContext(Paths.get(fixture.getString("preferences"))));
        String base=fixture.getString("base"),phase=fixture.getString("phase");backend.saveBaseUrl(base);
        SharedBackendBridge bridge=new SharedBackendBridge(backend);
        if(phase.equals("revoked")){
            check("credential-survives-host-process-restart",backend.sharedAuthStatus().getBoolean("paired"));
            boolean unauthorized=false;try{bridge.handle("sharedInfo",new JSONObject());}catch(BackendServices.ServiceException e){unauthorized=e.httpStatus==401&&e.remoteCode.equals("DEVICE_UNAUTHORIZED");}
            check("revoked-bearer-preserves-401-machine-code",unauthorized);
            check("revoked-bearer-cleared-private-current-scope",!backend.sharedAuthStatus().getBoolean("paired"));
        }else{
            if(phase.equals("paired"))verifyRouting();
            JSONObject paired=bridge.handle("sharedPair",new JSONObject().put("code",fixture.getString("code")).put("deviceName","synthetic native host"));
            check("pair-response-never-exposes-token",paired.getBoolean("paired")&&!paired.toString().contains("token"));
            JSONObject info=bridge.handle("sharedInfo",new JSONObject());
            check("paired-bearer-authorizes-shared-info",info.getBoolean("sameBusinessStore"));
            String library=info.getString("libraryId"),epoch=info.getString("epoch");
            JSONObject identity=new JSONObject().put("libraryId",library).put("epoch",epoch).put("limit",200);
            if(phase.equals("paired"))verifyNewHttpPorts(bridge,fixture,identity);
            if(phase.equals("paired")&&fixture.optBoolean("media"))verifyMedia(bridge,identity);
            check("bridge-snapshot-route",bridge.handle("sharedSnapshot",identity).has("entities"));
            check("bridge-pull-route",bridge.handle("sharedPull",new JSONObject(identity.toString()).put("after",0)).has("changes"));
            JSONObject wire=new JSONObject().put("libraryId",library).put("epoch",epoch).put("operationId",UUID.randomUUID().toString()).put("action","conversation-list").put("input",new JSONObject());
            check("bridge-command-preserves-fixed-envelope",bridge.handle("sharedCommand",wire).getJSONObject("result").has("conversations"));
            check("bridge-auth-status-never-exposes-token",!bridge.handle("sharedAuthStatus",new JSONObject()).toString().contains("token"));
            boolean rejected=false;try{bridge.handle("/api/access",new JSONObject());}catch(BackendServices.ServiceException e){rejected=e.kind==BackendServices.Failure.INVALID_INPUT;}
            check("bridge-arbitrary-action-rejected",rejected);
            backend.saveBaseUrl(base+"/different-service");check("bearer-not-migrated-to-different-base",!backend.sharedAuthStatus().getBoolean("paired"));
            backend.saveBaseUrl(base);check("original-base-credential-retained",backend.sharedAuthStatus().getBoolean("paired"));
            boolean rebound=false;try{backend.sharedCommand(UUID.randomUUID().toString(),"conversation-list",new JSONObject());}catch(BackendServices.ServiceException e){rebound=e.kind==BackendServices.Failure.CONFIG_CHANGED;}
            check("configuration-change-requires-explicit-library-info",rebound);
            if(phase.equals("forget")){
                check("bridge-forget-is-explicit-and-redacted",!bridge.handle("sharedForgetDevice",new JSONObject()).getBoolean("paired"));
                boolean unauthorized=false;try{backend.sharedInfo();}catch(BackendServices.ServiceException e){unauthorized=e.httpStatus==401;}
                check("forgotten-device-no-longer-sends-bearer",unauthorized);
            }
        }
        JSONObject result=new JSONObject().put("ok",true).put("phase",phase).put("checks",checks).put("authStatus",backend.sharedAuthStatus());
        Files.write(Paths.get(fixture.getString("result")),result.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        System.out.println("SharedBackendHostProbe "+phase+": "+checks.length()+" checks");
    }
    private static void verifyRouting()throws Exception{
        SharedBackendBridge routing=new SharedBackendBridge(new SharedBackendBridge.Port(){
            JSONObject value(String port)throws Exception{return new JSONObject().put("port",port).put("future",new JSONArray().put("unknown"));}
            public JSONObject info()throws Exception{return value("info");}public JSONObject snapshot(JSONObject q)throws Exception{return value("snapshot").put("input",q);}
            public JSONObject pull(JSONObject q)throws Exception{return value("pull");}public JSONObject command(JSONObject q)throws Exception{return value("command").put("input",q);}
            public JSONObject unlock(String p)throws Exception{check("unlock-payload-extracted-without-exposure",p.equals("synthetic-password"));return value("unlock");}
            public JSONObject pair(String c,String n)throws Exception{check("pair-payload-extracted-without-exposure",c.equals("synthetic-code")&&n.equals("synthetic-device"));return value("pair");}
            public JSONObject authStatus()throws Exception{return value("status");}public JSONObject forgetDevice()throws Exception{return value("forget");}
            public JSONObject mediaRead(JSONObject q)throws Exception{return value("mediaRead");}public JSONObject mediaBegin(JSONObject q)throws Exception{return value("mediaBegin");}
            public JSONObject mediaChunk(JSONObject q)throws Exception{return value("mediaChunk");}public JSONObject mediaComplete(JSONObject q)throws Exception{return value("mediaComplete");}
            public JSONObject entityRead(JSONObject q)throws Exception{return value("entityRead");}
            public JSONObject feedItemRead(JSONObject q)throws Exception{return value("feedItemRead");}
            public JSONObject seedResolve(JSONObject q)throws Exception{return value("seedResolve");}
            public JSONObject seedRegister(JSONObject q)throws Exception{return value("seedRegister");}
        });
        JSONObject q=new JSONObject().put("password","synthetic-password").put("code","synthetic-code").put("deviceName","synthetic-device");
        String[][] routes={{"sharedInfo","info"},{"sharedSnapshot","snapshot"},{"sharedPull","pull"},{"sharedCommand","command"},{"sharedUnlock","unlock"},{"sharedPair","pair"},{"sharedAuthStatus","status"},{"sharedForgetDevice","forget"},{"sharedMediaRead","mediaRead"},{"sharedMediaBegin","mediaBegin"},{"sharedMediaChunk","mediaChunk"},{"sharedMediaComplete","mediaComplete"},{"sharedEntityRead","entityRead"}};
        for(String[] route:routes){JSONObject output=routing.handle(route[0],q);check("fixed-bridge-route-"+route[0],output.getString("port").equals(route[1])&&output.getJSONArray("future").getString(0).equals("unknown"));}
        for(String[] route:new String[][]{{"sharedFeedItemRead","feedItemRead"},{"sharedSeedResolve","seedResolve"},{"sharedSeedRegister","seedRegister"}}){JSONObject output=routing.handle(route[0],q);check("fixed-bridge-route-"+route[0],output.getString("port").equals(route[1]));}
        JSONObject isolated=routing.handle("sharedCommand",q).getJSONObject("input");q.put("later",true);
        check("bridge-input-copy-keeps-caller-isolation",!isolated.has("later"));
        boolean typeRejected=false;try{routing.handle("sharedUnlock",new JSONObject().put("password",7));}catch(BackendServices.ServiceException e){typeRejected=e.kind==BackendServices.Failure.INVALID_INPUT;}
        check("bridge-unlock-rejects-nonstring",typeRejected);
    }
    private static String sha(byte[] bytes)throws Exception{
        byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
    }
    private static void verifyNewHttpPorts(SharedBackendBridge bridge,JSONObject fixture,JSONObject identity)throws Exception{
        JSONObject read;try{read=bridge.handle("sharedFeedItemRead",fixture.getJSONObject("feedInput"));}catch(BackendServices.ServiceException e){throw new AssertionError("feed-code="+e.remoteCode,e);}byte[] bytes=Base64.getDecoder().decode(read.getString("bytesBase64"));
        check("http-feed-item-fixed-bearer-chunk-sha",bytes.length==262144&&read.getString("chunkSha256").equals(sha(bytes)));
        JSONObject entity=bridge.handle("sharedEntityRead",fixture.getJSONObject("entityInput"));byte[] eb=Base64.getDecoder().decode(entity.getString("bytesBase64"));
        check("http-entity-fixed-bearer-chunk-sha",eb.length==262144&&entity.getString("chunkSha256").equals(sha(eb)));
        JSONObject seed=fixture.getJSONObject("seedInput");
        check("http-seed-register-fixed-bearer",bridge.handle("sharedSeedRegister",seed).getBoolean("registered"));
        check("http-seed-resolve-fixed-bearer",bridge.handle("sharedSeedResolve",seed).getBoolean("resolved"));
        char[] chars=new char[5*1024*1024];Arrays.fill(chars,'x');String padding=new String(chars);
        for(String action:new String[]{"sharedSeedRegister","sharedSeedResolve"}){boolean reached=false;try{bridge.handle(action,new JSONObject(seed.toString()).put("unexpected",padding));}catch(BackendServices.ServiceException e){reached=e.httpStatus==400&&e.kind!=BackendServices.Failure.TOO_LARGE;}check("http-seed-only-large-request-reaches-validation-"+action,reached);}
        JSONObject largeCommand=new JSONObject().put("libraryId",identity.getString("libraryId")).put("epoch",identity.getString("epoch")).put("operationId",UUID.randomUUID().toString()).put("action","conversation-list").put("input",new JSONObject().put("padding",padding));
        boolean capped=false;try{bridge.handle("sharedCommand",largeCommand);}catch(BackendServices.ServiceException e){capped=e.kind==BackendServices.Failure.TOO_LARGE&&e.httpStatus==0;}check("ordinary-business-request-still-capped-at-4MiB",capped);
        String conversationId=fixture.getJSONObject("feedInput").getJSONObject("payload").getString("conversationId");
        JSONObject wallpaper=new JSONObject(identity.toString());wallpaper.remove("limit");wallpaper.put("operationId",UUID.randomUUID().toString()).put("action","wallpaper-read").put("input",new JSONObject().put("conversationId",conversationId));
        JSONObject prior=bridge.handle("sharedCommand",wallpaper).getJSONObject("result");check("http-wallpaper-read-in-native-action-allowlist",prior.getString("conversationId").equals(conversationId));
        wallpaper.put("operationId",UUID.randomUUID().toString()).put("action","wallpaper-save").put("input",new JSONObject().put("conversationId",conversationId).put("scope","shared").put("expectedRevision",prior.getLong("revision")).put("syncEnabled",false).put("sharedAssetId",JSONObject.NULL));
        bridge.handle("sharedCommand",wallpaper);wallpaper.put("operationId",UUID.randomUUID().toString()).put("action","wallpaper-read").put("input",new JSONObject().put("conversationId",conversationId));
        check("http-wallpaper-save-in-native-action-allowlist",!bridge.handle("sharedCommand",wallpaper).getJSONObject("result").getBoolean("syncEnabled"));
    }
    private static void verifyMedia(SharedBackendBridge bridge,JSONObject identity)throws Exception{
        byte[] original=new byte[400003];for(int n=0;n<original.length;n++)original[n]=(byte)(n*17+3);
        String operation=UUID.randomUUID().toString();
        JSONObject scope=new JSONObject().put("libraryId",identity.getString("libraryId")).put("epoch",identity.getString("epoch")).put("operationId",operation);
        JSONObject begin=new JSONObject(scope.toString()).put("metadata",new JSONObject().put("name","synthetic native original.bin").put("mime","application/octet-stream").put("size",original.length).put("sha256",sha(original)));
        JSONObject started=bridge.handle("sharedMediaBegin",begin);
        check("media-begin-fixed-route-empty-cursor",started.getLong("next")==0&&!started.getBoolean("complete")&&started.getInt("maxChunkBytes")==262144);
        int offset=0;boolean resumed=false,replayed=false;
        while(offset<original.length){byte[] chunk=Arrays.copyOfRange(original,offset,Math.min(original.length,offset+131072));JSONObject input=new JSONObject(scope.toString()).put("offset",offset).put("bytesBase64",Base64.getEncoder().encodeToString(chunk)).put("chunkSha256",sha(chunk));
            JSONObject accepted=bridge.handle("sharedMediaChunk",input);if(accepted.getLong("next")!=offset+chunk.length)throw new AssertionError("media-upload-cursor");
            if(offset==0){JSONObject repeat=bridge.handle("sharedMediaChunk",input);replayed=repeat.getBoolean("replayed")&&repeat.getLong("next")==chunk.length;resumed=bridge.handle("sharedMediaBegin",begin).getLong("next")==chunk.length;}
            offset+=chunk.length;
        }
        check("media-chunk-replay-keeps-cursor",replayed);check("media-begin-resumes-original-operation",resumed);
        JSONObject completed=bridge.handle("sharedMediaComplete",scope),asset=completed.getJSONObject("asset");
        check("media-complete-returns-original-metadata",completed.getBoolean("complete")&&asset.getLong("size")==original.length&&asset.getString("sha256").equals(sha(original))&&asset.getString("type").equals("application/octet-stream"));
        check("media-complete-replay-same-asset",bridge.handle("sharedMediaComplete",scope).getJSONObject("asset").getString("id").equals(asset.getString("id")));
        ByteArrayOutputStream recovered=new ByteArrayOutputStream();offset=0;boolean chunksVerified=true,done=false;
        while(!done){JSONObject part=bridge.handle("sharedMediaRead",new JSONObject().put("libraryId",identity.getString("libraryId")).put("epoch",identity.getString("epoch")).put("assetId",asset.getString("id")).put("offset",offset).put("length",123457));byte[] bytes=Base64.getDecoder().decode(part.getString("bytesBase64"));chunksVerified&=part.getLong("offset")==offset&&part.getLong("next")==offset+bytes.length&&part.getString("chunkSha256").equals(sha(bytes));recovered.write(bytes);offset+=bytes.length;done=part.getBoolean("done");}
        check("media-read-ranges-and-chunk-sha-verified",chunksVerified);check("media-full-original-byte-round-trip",Arrays.equals(original,recovered.toByteArray()));
        JSONObject changed=new JSONObject(begin.toString());changed.getJSONObject("metadata").put("name","cannot change immutable metadata");boolean refused=false;try{bridge.handle("sharedMediaBegin",changed);}catch(BackendServices.ServiceException e){refused=e.httpStatus==409&&e.remoteCode.equals("SHARED_OPERATION_REUSED");}check("media-operation-metadata-reuse-rejected",refused);
    }
}

