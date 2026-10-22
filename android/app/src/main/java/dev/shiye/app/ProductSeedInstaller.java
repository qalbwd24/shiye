package dev.shiye.app;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;

/** Network proof and private originals are prepared outside SQLite. All data/index/cursor
 * changes then commit together on the existing LocalStore ProductRepository connection. */
final class ProductSeedInstaller {
    private final LocalStore store;private final AndroidSyncTransport transport;private final ProductChatStore chat;private final File originals;
    ProductSeedInstaller(Context context,LocalStore store,AndroidSyncTransport transport,ProductChatStore chat)throws Exception{
        this.store=store;this.transport=transport;this.chat=chat;originals=new File(context.getNoBackupFilesDir(),"product-originals-v1").getCanonicalFile();
        if(!originals.isDirectory()&&!originals.mkdirs())throw new IOException("SEED_ORIGINAL_DIRECTORY");
    }
    JSONObject install(ProductSeedFile.Prepared seed,ProductSeedFile.Cancellation cancellation,ProductSeedFile.Progress progress)throws Exception{
        ProductSeedFile.active(cancellation);JSONObject manifest=seed.manifest(),info=transport.connect(),catalog=transport.catalog();
        for(String field:new String[]{"libraryId","epoch"})if(!manifest.getString(field).equals(info.optString(field))||!manifest.getString(field).equals(catalog.optString(field)))throw new IOException("SEED_LIBRARY_MISMATCH");
        JSONObject request=new JSONObject();for(String field:new String[]{"packageId","libraryId","epoch","checkpoint"})request.put(field,manifest.get(field));request.put("sha256",seed.sha256());
        JSONObject proof=transport.seedResolve(request);ProductSeedFile.active(cancellation);
        store.withProduct(r->{r.bindIdentity(info);return null;});
        JSONObject targetMeta=store.withProduct(ProductRepository::metadata);boolean samePackage=false;JSONArray installedPackages=targetMeta.optJSONArray("seedPackages");if(installedPackages!=null)for(int i=0;i<installedPackages.length();i++)if(seed.sha256().equals(installedPackages.getString(i)))samePackage=true;
        if(!samePackage&&(targetMeta.optBoolean("initialized")||targetMeta.has("snapshotCursor")))throw new IOException("SEED_TARGET_ALREADY_INITIALIZED");
        Set<String> redactedAssets=new HashSet<>();JSONArray redactions=proof.optJSONArray("redactions");
        if(redactions!=null)for(int n=0;n<redactions.length();n++){JSONObject row=redactions.getJSONObject(n);if("asset".equals(row.optString("entityType"))&&!"active".equals(row.optString("state")))redactedAssets.add(row.getString("entityId"));}
        Map<String,JSONObject> assets=seed.assets(),mappings=new LinkedHashMap<>();int count=0;
        for(Map.Entry<String,JSONObject> item:assets.entrySet()){
            ProductSeedFile.active(cancellation);String id=item.getKey();JSONObject asset=item.getValue();
            if(redactedAssets.contains(id))continue;
            JSONObject previous=store.withProduct(r->r.transaction(tx->tx.getMapping("product-original019",id)));
            if(previous!=null){if(!asset.getString("sha256").equals(previous.optString("sha256"))||asset.getLong("size")!=previous.optLong("size",-1))throw new IOException("SEED_LOCAL_MEDIA_CONFLICT");File file=new File(previous.getString("path"));if(file.isFile()&&file.length()==asset.getLong("size")&&ProductSeedFile.hash(file,cancellation).equals(asset.getString("sha256"))){mappings.put(id,previous);continue;}throw new IOException("SEED_LOCAL_MEDIA_UNAVAILABLE");}
            File target=new File(originals,"seed-"+asset.getString("sha256"));
            if(target.exists()){if(target.length()!=asset.getLong("size")||!ProductSeedFile.hash(target,cancellation).equals(asset.getString("sha256")))throw new IOException("SEED_ORIGINAL_COLLISION");}
            else{
                File part=new File(originals,"seed-part-"+UUID.randomUUID());MessageDigest hash=MessageDigest.getInstance("SHA-256");long bytes=0;
                Exception failure=null;
                try{
                    try(InputStream in=new BufferedInputStream(new FileInputStream(seed.original(id)));FileOutputStream out=new FileOutputStream(part)){byte[] block=new byte[262144];int n;while((n=in.read(block))!=-1){ProductSeedFile.active(cancellation);bytes+=n;if(bytes>asset.getLong("size"))throw new IOException("SEED_ORIGINAL_CHANGED");out.write(block,0,n);hash.update(block,0,n);}out.getFD().sync();}
                    if(bytes!=asset.getLong("size")||!ProductSeedFile.hex(hash.digest()).equals(asset.getString("sha256")))throw new IOException("SEED_ORIGINAL_CHANGED");
                    try{Files.move(part.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);}catch(FileAlreadyExistsException collision){if(!ProductSeedFile.hash(target,cancellation).equals(asset.getString("sha256")))throw new IOException("SEED_ORIGINAL_COLLISION");}
                }catch(Exception error){failure=error;throw error;}
                finally{try{Files.deleteIfExists(part.toPath());}catch(IOException cleanup){if(failure!=null)failure.addSuppressed(cleanup);else throw cleanup;}}
            }
            JSONObject saved=new JSONObject(asset.toString()).put("id",id).put("assetId",id).put("path",target.getCanonicalPath());mappings.put(id,saved);
            if(progress!=null)progress.update("publishing-originals",++count,assets.size());
        }
        ProductSeedFile.active(cancellation);
        return store.withProduct(r->r.importSeed(manifest,seed.sha256(),proof,visitor->seed.forEach(visitor::accept),tx->{
            for(Map.Entry<String,JSONObject> item:mappings.entrySet()){
                ProductSeedFile.active(cancellation);String id=item.getKey();JSONObject value=item.getValue();
                if(redactedAssets.contains(id)||ProductMediaBridge.assetRedacted(tx.getEntity("asset",id)))continue;
                JSONObject existing=tx.getMapping("product-original019",id);if(existing==null)tx.putMapping("product-original019",id,value);
                else if(!existing.optString("sha256").equals(value.optString("sha256"))||existing.optLong("size",-1)!=value.optLong("size",-2))throw new IOException("SEED_LOCAL_MEDIA_CONFLICT");
                if(ProductMediaBridge.chatCompatible(value)){JSONObject old=tx.getMapping("chat-media019",id);if(old==null)chat.registerMedia(tx,value);else if(!old.optString("sha256").equals(value.optString("sha256"))||old.optLong("size",-1)!=value.optLong("size",-2))throw new IOException("SEED_LOCAL_MEDIA_CONFLICT");}
            }
        },()->ProductSeedFile.active(cancellation)));
    }
}
