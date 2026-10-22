package dev.shiye.app;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Synthetic host integrity/lifecycle probe. No Android runtime, database or device. */
public final class SharedSeedHostProbe {
    static final JSONArray checks=new JSONArray();
    interface Work{void run()throws Exception;}
    static void check(String name,boolean ok){if(!ok)throw new AssertionError(name);checks.put(name);}
    static void reject(String name,Work work)throws Exception{boolean rejected=false;try{work.run();}catch(Exception expected){rejected=true;}check(name,rejected);}
    static String sha(byte[] b)throws Exception{return SharedSeedFile.hex(MessageDigest.getInstance("SHA-256").digest(b));}
    static JSONObject q(String key,Object value)throws Exception{return new JSONObject().put(key,value);}
    static byte[] container(JSONObject manifest,byte[][] members)throws Exception{ByteArrayOutputStream raw=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(raw);out.write("SHIYE-SEED-V1\n".getBytes(StandardCharsets.UTF_8));byte[] m=manifest.toString().getBytes(StandardCharsets.UTF_8);out.writeInt(m.length);out.write(m);for(byte[] b:members)out.write(b);return raw.toByteArray();}
    static byte[] zip(byte[] raw,String name)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream out=new ZipOutputStream(bytes)){out.putNextEntry(new ZipEntry(name));out.write(raw);out.closeEntry();out.putNextEntry(new ZipEntry("coverage.json"));out.write("{}".getBytes(StandardCharsets.UTF_8));out.closeEntry();}return bytes.toByteArray();}
    public static void main(String[] args)throws Exception{
        File root=new File(args[0]);root.mkdirs();byte[] entity="{\"synthetic\":true}".getBytes(StandardCharsets.UTF_8),original=new byte[400003];for(int n=0;n<original.length;n++)original[n]=(byte)(n*17+3);
        String eh=sha(entity),oh=sha(original),library=UUID.randomUUID().toString(),epoch=UUID.randomUUID().toString();
        JSONObject asset=new JSONObject().put("assetId","native-synthetic-original").put("sha256",oh).put("size",original.length).put("mime","application/octet-stream").put("name","原件.bin").put("path","media/"+oh);
        JSONObject manifest=new JSONObject().put("format","shiye-shared-seed").put("mode","shared-bootstrap").put("version",1).put("packageId",UUID.randomUUID().toString()).put("libraryId",library).put("epoch",epoch).put("snapshotWatermark",0).put("watermark",1).put("complete",true).put("cursor",new JSONObject().put("libraryId",library).put("epoch",epoch).put("after",1)).put("containsCredentials",false).put("containsSourceArchives",false).put("bytes",entity.length+original.length).put("entityBytes",entity.length).put("entityCount",1).put("assetCount",1)
            .put("entities",new JSONArray().put(new JSONObject().put("entityType","media").put("entityId",asset.getString("assetId")).put("revision",1).put("seq",1).put("sha256",eh).put("path","entities/"+eh+".json")))
            .put("assets",new JSONArray().put(asset)).put("members",new JSONArray().put(new JSONObject().put("path","entities/"+eh+".json").put("sha256",eh).put("size",entity.length)).put(new JSONObject().put("path","media/"+oh).put("sha256",oh).put("size",original.length)));
        byte[] raw=container(manifest,new byte[][]{entity,original});File privateRoot=new File(root,"private");
        SharedSeedBridge bridge=new SharedSeedBridge(privateRoot);
        JSONObject selected=bridge.prepare(new ByteArrayInputStream(raw),sha(raw),null,null);String token=selected.getString("seedToken");
        JSONObject ticket=bridge.prepareTicket(new ByteArrayInputStream(raw),sha(raw),null,null);check("native-small-ticket-no-inline-manifest",ticket.toString().length()<2048&&!ticket.getJSONObject("manifest").has("members"));
        ByteArrayOutputStream manifestBytes=new ByteArrayOutputStream();for(int offset=0;offset<ticket.getJSONObject("manifest").getInt("byteLength");offset+=131072){int length=Math.min(131072,ticket.getJSONObject("manifest").getInt("byteLength")-offset);JSONObject block=bridge.handle("sharedSeedManifestRead",q("seedToken",ticket.getString("seedToken")).put("offset",offset).put("length",length));manifestBytes.write(Base64.getDecoder().decode(block.getString("bytesBase64")));}check("native-manifest-paged-original-sha",sha(manifestBytes.toByteArray()).equals(ticket.getJSONObject("manifest").getString("sha256")));bridge.handle("sharedSeedClose",q("seedToken",ticket.getString("seedToken")));
        check("native-container-keeps-shared-manifest",selected.getJSONObject("manifest").getString("format").equals("shiye-shared-seed"));
        JSONObject rq=q("seedToken",token).put("path","media/"+oh).put("offset",262144).put("length",original.length-262144);
        JSONObject part=bridge.handle("sharedSeedReadMember",rq);check("member-bounded-range-and-sha",Arrays.equals(Base64.getDecoder().decode(part.getString("bytesBase64")),Arrays.copyOfRange(original,262144,original.length))&&part.getString("chunkSha256").equals(sha(Arrays.copyOfRange(original,262144,original.length))));
        reject("member-traversal-rejected",()->bridge.handle("sharedSeedReadMember",new JSONObject(rq.toString()).put("path","../../secret")));
        reject("member-oversize-range-rejected",()->bridge.handle("sharedSeedReadMember",new JSONObject(rq.toString()).put("length",262145)));
        reject("member-noninteger-range-rejected",()->bridge.handle("sharedSeedReadMember",new JSONObject(rq.toString()).put("offset",0.5)));
        String stage=bridge.handle("sharedSeedOriginalBegin",q("asset",asset)).getString("token");
        reject("stage-cursor-gap-rejected",()->bridge.handle("sharedSeedOriginalWrite",q("token",stage).put("offset",1).put("bytesBase64","AQ==")));
        for(int offset=0;offset<original.length;offset+=262144){byte[] b=Arrays.copyOfRange(original,offset,Math.min(original.length,offset+262144));bridge.handle("sharedSeedOriginalWrite",q("token",stage).put("offset",offset).put("bytesBase64",Base64.getEncoder().encodeToString(b)));}
        String handle=bridge.handle("sharedSeedOriginalFinish",q("token",stage).put("asset",asset)).getString("handle");check("finished-handle-opaque",handle.startsWith("shared-seed-original:")&&!handle.contains(privateRoot.toString()));
        check("finish-retry-same-handle",bridge.handle("sharedSeedOriginalFinish",q("token",stage).put("asset",asset)).getString("handle").equals(handle));
        bridge.handle("sharedSeedClose",q("seedToken",token));reject("container-close-revokes-token",()->bridge.handle("sharedSeedReadMember",rq));
        bridge.close();SharedSeedBridge reopened=new SharedSeedBridge(privateRoot);
        JSONObject first=reopened.handle("sharedSeedOriginalRead",q("handle",handle).put("offset",0).put("length",262144));check("durable-original-survives-bridge-close-reopen",first.getString("sha256").equals(oh)&&Arrays.equals(Base64.getDecoder().decode(first.getString("bytesBase64")),Arrays.copyOfRange(original,0,262144)));
        reject("opaque-original-path-traversal-rejected",()->reopened.handle("sharedSeedOriginalRead",q("handle","../../secret").put("offset",0).put("length",1)));
        reopened.handle("sharedSeedOriginalDiscard",q("handle",handle));reject("discard-revokes-durable-original",()->reopened.handle("sharedSeedOriginalRead",q("handle",handle).put("offset",0).put("length",1)));
        JSONObject wrapped=reopened.prepare(new ByteArrayInputStream(zip(raw,"data.syseed")),sha(raw),null,null);check("restricted-zip-wrapper-roundtrip",wrapped.getString("sha256").equals(sha(raw)));reopened.handle("sharedSeedClose",q("seedToken",wrapped.getString("seedToken")));
        String conversation="desktop:"+UUID.randomUUID().toString()+":-1",head=String.join("",Collections.nCopies(64,"a"));
        byte[] feedBytes=new JSONObject().put("format","shiye-conversation-feed-part").put("version",1).put("conversationId",conversation).put("watermark",1).put("feedRevision",head).put("messages",new JSONArray()).put("redactions",new JSONArray()).toString().getBytes(StandardCharsets.UTF_8);String feedHash=sha(feedBytes);
        JSONObject feedPart=new JSONObject().put("path","entities/"+feedHash+".json").put("sha256",feedHash).put("size",feedBytes.length).put("rowCount",0).put("redactionCount",0);
        JSONObject v2=new JSONObject(manifest.toString()).put("version",2).put("requiredFeatures",new JSONArray().put("conversation-feeds-v1")).put("conversationFeeds",new JSONArray().put(new JSONObject().put("conversationId",conversation).put("watermark",1).put("feedRevision",head).put("rosterSha256",head).put("rowCount",0).put("redactionCount",0).put("parts",new JSONArray().put(feedPart)))).put("bytes",entity.length+original.length+feedBytes.length).put("entityBytes",entity.length+feedBytes.length);
        v2.getJSONArray("members").put(new JSONObject().put("path",feedPart.getString("path")).put("sha256",feedHash).put("size",feedBytes.length));
        JSONObject v2ticket=reopened.prepareTicket(new ByteArrayInputStream(container(v2,new byte[][]{entity,original,feedBytes})),null,null,null);JSONObject feedBlock=reopened.handle("sharedSeedReadMember",q("seedToken",v2ticket.getString("seedToken")).put("path",feedPart.getString("path")).put("offset",0).put("length",feedBytes.length));check("v2-known-required-feed-part-bounded-read",Arrays.equals(feedBytes,Base64.getDecoder().decode(feedBlock.getString("bytesBase64"))));reopened.handle("sharedSeedClose",q("seedToken",v2ticket.getString("seedToken")));
        JSONObject unknownFeature=new JSONObject(v2.toString()).put("requiredFeatures",new JSONArray().put("future-unknown"));reject("v2-unknown-required-feature-rejected",()->reopened.prepare(new ByteArrayInputStream(container(unknownFeature,new byte[][]{entity,original,feedBytes})),null,null,null));
        JSONObject downgrade=new JSONObject(v2.toString()).put("version",1);reject("v1-cannot-silently-ignore-required-feed-feature",()->reopened.prepare(new ByteArrayInputStream(container(downgrade,new byte[][]{entity,original,feedBytes})),null,null,null));
        JSONObject wrongCounts=new JSONObject(v2.toString());wrongCounts.getJSONArray("conversationFeeds").getJSONObject(0).put("rowCount",1);reject("v2-projection-count-mismatch-rejected",()->reopened.prepare(new ByteArrayInputStream(container(wrongCounts,new byte[][]{entity,original,feedBytes})),null,null,null));
        byte[] corruptFeed=feedBytes.clone();corruptFeed[0]^=1;reject("v2-projection-member-hash-rejected",()->reopened.prepare(new ByteArrayInputStream(container(v2,new byte[][]{entity,original,corruptFeed})),null,null,null));
        reject("zip-arbitrary-path-rejected",()->reopened.prepare(new ByteArrayInputStream(zip(raw,"../data.syseed")),null,null,null));
        byte[] changed=raw.clone();changed[changed.length-1]^=1;
        reject("member-corruption-rejected",()->reopened.prepare(new ByteArrayInputStream(changed),null,null,null));
        reject("full-package-hash-mismatch-rejected",()->reopened.prepare(new ByteArrayInputStream(raw),String.join("",Collections.nCopies(64,"0")),null,null));
        reject("truncated-container-rejected",()->reopened.prepare(new ByteArrayInputStream(Arrays.copyOf(raw,raw.length-1)),null,null,null));
        byte[] extra=Arrays.copyOf(raw,raw.length+1);reject("trailing-byte-rejected",()->reopened.prepare(new ByteArrayInputStream(extra),null,null,null));
        JSONObject product=new JSONObject(manifest.toString()).put("format","shiye-product-seed").put("mode","product-bootstrap");reject("product-seed-cannot-enter-shared-lane",()->reopened.prepare(new ByteArrayInputStream(container(product,new byte[][]{entity,original})),null,null,null));
        JSONObject traversal=new JSONObject(manifest.toString());traversal.getJSONArray("members").getJSONObject(0).put("path","../../file");reject("manifest-path-traversal-rejected",()->reopened.prepare(new ByteArrayInputStream(container(traversal,new byte[][]{entity,original})),null,null,null));
        reject("cancelled-prepare-rejected",()->reopened.prepare(new ByteArrayInputStream(raw),null,()->true,null));
        check("failed-containers-cleaned",new File(privateRoot,"containers").list().length==0);
        String abandoned=reopened.handle("sharedSeedOriginalBegin",q("asset",asset)).getString("token");reopened.handle("sharedSeedOriginalAbort",q("token",abandoned));check("aborted-stage-cleaned",new File(privateRoot,"originals").list().length==0);
        reopened.close();Files.write(Paths.get(args[1]),new JSONObject().put("ok",true).put("hostJava",true).put("actualAndroid",false).put("checks",checks).toString(2).getBytes(StandardCharsets.UTF_8));System.out.println("SharedSeedHostProbe: "+checks.length()+" checks");
    }
}
