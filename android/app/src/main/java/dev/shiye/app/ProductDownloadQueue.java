package dev.shiye.app;

import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Original dependencies recorded with inbox/cursor, so restarts cannot lose downloads. */
final class ProductDownloadQueue {
    static void track(JSONObject meta,JSONArray entities)throws Exception{
        Set<String> ids=new LinkedHashSet<>();JSONArray prior=meta.optJSONArray("originalsPending021");
        if(prior!=null)for(int n=0;n<prior.length();n++)ids.add(prior.getString(n));
        for(int i=0;i<entities.length();i++){
            JSONObject entity=entities.getJSONObject(i),data=entity.optJSONObject("data");
            if(!"active".equals(entity.optString("state"))||data==null)continue;
            JSONObject product=data.optJSONObject("_product"),refs=product==null?null:product.optJSONObject("refs");
            JSONObject payload=product==null?null:product.optJSONObject("payload");if(payload!=null&&payload.opt("assetId") instanceof String)ids.add(payload.getString("assetId"));
            if(refs==null)continue;
            JSONArray assets=refs.optJSONArray("assets");if(assets!=null)for(int n=0;n<assets.length();n++)ids.add(assets.getString(n));
            if("media".equals(product.optString("kind"))&&refs.opt("asset") instanceof String)ids.add(refs.getString("asset"));
        }
        meta.put("originalsPending021",new JSONArray(ids));
    }
    static JSONArray pending(ProductRepository repository)throws Exception{return repository.transaction(tx->{
        JSONObject meta=tx.getMeta();
        if(!meta.optBoolean("originalsPayloadIndexed022")){
            JSONArray records=tx.listEntities(),entities=new JSONArray();for(int i=0;i<records.length();i++){JSONObject local=records.getJSONObject(i).optJSONObject("local");if(local!=null)entities.put(local);}
            track(meta,entities);meta.put("originalsIndexed021",true).put("originalsPayloadIndexed022",true);tx.setMeta(meta);
        }
        JSONArray pending=meta.optJSONArray("originalsPending021"),available=new JSONArray();if(pending!=null)for(int i=0;i<pending.length();i++){String id=pending.getString(i);JSONObject record=tx.getEntity("asset",id),base=record==null?null:record.optJSONObject("base"),local=record==null?null:record.optJSONObject("local");if((base==null||"active".equals(base.optString("state")))&&(local==null||"active".equals(local.optString("state"))))available.put(id);}return available;
    });}
    static void complete(ProductRepository repository,String id)throws Exception{repository.transaction(tx->{
        JSONObject meta=tx.getMeta();JSONArray old=meta.optJSONArray("originalsPending021"),next=new JSONArray();if(old!=null)for(int i=0;i<old.length();i++)if(!id.equals(old.getString(i)))next.put(old.getString(i));meta.put("originalsPending021",next);tx.setMeta(meta);return null;
    });}
}
