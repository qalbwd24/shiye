package dev.shiye.app;

import org.json.JSONArray;
import org.json.JSONObject;

/** Explicit opt-in for preserved Product Entries, with dependencies in the SAME transaction. */
final class ProductLocalSelection {
    static JSONObject queue(ProductRepository repository,int limit)throws Exception{
        return repository.transaction(tx->{
            JSONObject meta=tx.getMeta();tx.guardIdentity(meta.optJSONObject("identity"));
            if(!meta.optBoolean("initialized"))throw new Exception("INITIAL_RECEIVE_REQUIRED");
            JSONArray rows=tx.listEntities();int queued=0,remaining=0;
            for(int i=0;i<rows.length();i++){
                JSONObject row=rows.getJSONObject(i),local=row.optJSONObject("local");
                if(!"journalAggregate".equals(row.optString("entityType"))||!row.optBoolean("localOnly")||local==null||!"active".equals(local.optString("state")))continue;
                JSONObject data=local.optJSONObject("data");if(data==null||data.optBoolean("draftOnly")||data.has("chatJournal"))continue;
                boolean pending=false;JSONArray jobs=tx.listPending("entity");
                for(int j=0;j<jobs.length();j++){JSONObject intent=jobs.getJSONObject(j).optJSONObject("intent");if(intent!=null&&row.optString("entityId").equals(intent.optString("entityId"))&&"journalAggregate".equals(intent.optString("entityType")))pending=true;}
                if(pending)continue;
                if(queued>=Math.max(1,Math.min(100,limit))){remaining++;continue;}
                dependencies(tx,data);
                JSONObject prepared=new JSONObject().put("entityType","journalAggregate").put("entityId",row.getString("entityId")).put("data",new JSONObject(data.toString()));
                ProductDiaryStore.validatePrepared(prepared);
                tx.enqueuePreparedEntryIntent(new JSONObject().put("entityType","journalAggregate").put("entityId",row.getString("entityId")).put("command","create").put("data",new JSONObject(data.toString())),row.getLong("localRevision"),prepared,null);queued++;
            }
            return new JSONObject().put("queuedEntries",queued).put("remainingEntries",remaining);
        });
    }
    static void dependencies(ProductRepository.Tx tx,JSONObject data)throws Exception{
        JSONObject product=data.optJSONObject("_product"),refs=product==null?null:product.optJSONObject("refs");
        if(refs!=null){
        if(refs.opt("category") instanceof String)taxonomy(tx,refs.getString("category"),"category",data.optString("category"));
        JSONArray tags=refs.optJSONArray("tags"),names=data.optJSONArray("tags");
        if(tags!=null)for(int n=0;n<tags.length();n++)taxonomy(tx,tags.getString(n),"tag",names==null?"":names.optString(n));
        JSONArray assets=refs.optJSONArray("assets");
        if(assets!=null)for(int n=0;n<assets.length();n++){
            String id=assets.getString(n);if(tx.getEntity("relation",id)!=null)continue;
            JSONObject media=tx.getMapping("product-original019",id);if(media==null)throw new Exception("LOCAL_ORIGINAL_REQUIRED");
            JSONObject value=new JSONObject().put("id",id).put("name",media.optString("name")).put("type",media.getString("mime")).put("size",media.getLong("size")).put("sha256",media.getString("sha256"))
                .put("_product",new JSONObject().put("schema",1).put("kind","media").put("refs",new JSONObject().put("asset",id)));
            tx.enqueueIntent(new JSONObject().put("entityType","relation").put("entityId",id).put("command","create").put("data",value),0,null);
        }
        }
    }
    private static void taxonomy(ProductRepository.Tx tx,String id,String kind,String name)throws Exception{
        if(tx.getEntity("taxonomy",id)!=null)return;
        if(name.isEmpty())throw new Exception("LOCAL_TAXONOMY_NAME_REQUIRED");
        JSONObject value=new JSONObject().put("id",id).put("kind",kind).put("name",name).put("_product",new JSONObject().put("schema",1).put("kind","taxonomy").put("refs",new JSONObject()));
        tx.enqueueIntent(new JSONObject().put("entityType","taxonomy").put("entityId",id).put("command","create").put("data",value),0,null);
    }
}
