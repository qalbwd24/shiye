package dev.shiye.app;

import org.json.JSONObject;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import java.util.Iterator;

/** Verified read projection only. The repository's wire base and pending intents stay unchanged. */
public final class ProductPayloadReader {
    private static final long MAX=64L*1024*1024;
    private ProductPayloadReader(){}
    static boolean packed(JSONObject envelope){JSONObject data=envelope==null?null:envelope.optJSONObject("data"),meta=data==null?null:data.optJSONObject("_product");return meta!=null&&meta.optJSONObject("payload")!=null;}
    public static JSONObject hydrate(ProductRepository repository,JSONObject envelope)throws Exception{
        if(envelope==null)return null;
        JSONObject result=new JSONObject(envelope.toString());
        if(!"active".equals(result.optString("state"))||!packed(result))return result;
        JSONObject meta=result.getJSONObject("data").getJSONObject("_product"),ref=meta.getJSONObject("payload");String assetId=ref.getString("assetId"),sha=ref.getString("sha256");long size=ref.getLong("size");
        if(!assetId.matches("[A-Za-z0-9_:@.-]{1,160}")||!sha.matches("[a-f0-9]{64}")||size<1||size>MAX)throw new IOException("PRODUCT_PAYLOAD_INVALID");
        JSONObject asset=repository.load("asset",assetId);if(asset!=null)for(String part:new String[]{"base","local"}){JSONObject state=asset.optJSONObject(part);if(state!=null&&!"active".equals(state.optString("state")))throw new IOException("PRODUCT_PAYLOAD_REDACTED");}
        JSONObject mapping=repository.transaction(tx->tx.getMapping("product-original019",assetId));
        if(mapping==null||size!=mapping.optLong("size",-1)||!sha.equals(mapping.optString("sha256")))throw new IOException("PRODUCT_PAYLOAD_NOT_READY");
        // Only native verified-original publishers can create this mapping; file-picker paths never enter it.
        File file=new File(mapping.getString("path")).getCanonicalFile();if(!file.isFile()||file.length()!=size)throw new IOException("PRODUCT_PAYLOAD_NOT_READY");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        try(InputStream in=new DigestInputStream(new BufferedInputStream(new FileInputStream(file)),digest)){byte[] block=new byte[262144];int n;while((n=in.read(block))!=-1){if(bytes.size()+(long)n>size)throw new IOException("PRODUCT_PAYLOAD_HASH_MISMATCH");bytes.write(block,0,n);}}
        StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));if(bytes.size()!=size||!sha.contentEquals(hash))throw new IOException("PRODUCT_PAYLOAD_HASH_MISMATCH");
        String json;try{json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();}catch(CharacterCodingException error){throw new IOException("PRODUCT_PAYLOAD_INVALID_UTF8");}
        JSONObject data=new JSONObject(json),next=data.optJSONObject("_product");if(next==null||next.has("payload")||next.optInt("schema")!=1||!next.optString("kind").equals(meta.optString("kind"))||!equal(next.opt("refs"),meta.opt("refs")))throw new IOException("PRODUCT_PAYLOAD_IDENTITY_MISMATCH");
        if("entry".equals(next.optString("kind"))&&!next.optBoolean("readOnlyProjection"))ProductDiaryStore.validatePrepared(new JSONObject().put("entityType",result.get("entityType")).put("entityId",result.get("entityId")).put("data",data));
        // Recheck tombstones after reading, so a concurrent withdrawal is not published from this read.
        JSONObject current=repository.load(result.getString("entityType"),result.getString("entityId")),currentLocal=current==null?null:current.optJSONObject("local");if(currentLocal!=null&&!"active".equals(currentLocal.optString("state")))throw new IOException("PRODUCT_PAYLOAD_REDACTED");
        asset=repository.load("asset",assetId);if(asset!=null)for(String part:new String[]{"base","local"}){JSONObject state=asset.optJSONObject(part);if(state!=null&&!"active".equals(state.optString("state")))throw new IOException("PRODUCT_PAYLOAD_REDACTED");}
        result.put("data",data);return result;
    }
    private static boolean equal(Object a,Object b)throws Exception{
        if(a==null||a==JSONObject.NULL)return b==null||b==JSONObject.NULL;
        if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> keys=x.keys();keys.hasNext();){String k=keys.next();if(!y.has(k)||!equal(x.get(k),y.get(k)))return false;}return true;}
        if(a instanceof org.json.JSONArray&&b instanceof org.json.JSONArray){org.json.JSONArray x=(org.json.JSONArray)a,y=(org.json.JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equal(x.get(i),y.get(i)))return false;return true;}
        return a.equals(b);
    }
}
