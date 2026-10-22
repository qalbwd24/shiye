package dev.shiye.app;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;

/** Product chat's local authority, using the SAME ProductRepository/SQLite transaction. No network. */
public final class ProductChatStore {
    private static final String DRAFTS="product019_chat_drafts", OPS="product019_chat_ops", IDS="product019_chat_ids";
    private final ProductRepository repository;
    private static final SecureRandom RANDOM=new SecureRandom();
    public static final class ChatException extends Exception {
        public final String code;
        ChatException(String code){super(code);this.code=code;}
    }
    private static ChatException error(String code){return new ChatException(code);}
    public ProductChatStore(ProductRepository repository)throws Exception{
        if(repository==null)throw new IllegalArgumentException("REPOSITORY_REQUIRED");this.repository=repository;
        repository.transaction(tx->{SQLiteDatabase db=tx.database();
            db.execSQL("CREATE TABLE IF NOT EXISTS "+DRAFTS+"(sourceId TEXT NOT NULL,roomId TEXT NOT NULL,value TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(sourceId,roomId))");
            db.execSQL("CREATE TABLE IF NOT EXISTS "+OPS+"(clientId TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL)");
            db.execSQL("CREATE TABLE IF NOT EXISTS "+IDS+"(entityId TEXT PRIMARY KEY,sourceId TEXT NOT NULL,roomId TEXT NOT NULL,messageId TEXT NOT NULL,sentAt TEXT,outgoing INTEGER NOT NULL)");return null;});
    }
    public JSONObject dispatch(String action,JSONObject payload)throws Exception{
        JSONObject value=copy(payload==null?new JSONObject():payload);
        switch(action){
            case "chatSnapshot":return snapshot(value);
            case "chatListRooms":return listRooms();
            case "chatSetDraft":return setDraft(value);
            case "chatSendText":return send(value);
            case "chatWithdraw":return withdraw(value);
            case "chatOperation":return operation(value);
            case "chatImportLegacyRoom":return importLegacyRoom(value);
            case "chatQueueOffline":return queueOffline(value);
            default:throw error("CHAT_ACTION_NOT_SUPPORTED");
        }
    }
    private static JSONObject copy(JSONObject value)throws Exception{return new JSONObject(value.toString());}
    private static String string(JSONObject value,String key)throws Exception{
        Object x=value.opt(key);if(!(x instanceof String)||((String)x).isEmpty())throw error("INVALID_"+key.toUpperCase(Locale.ROOT));return (String)x;
    }
    private static void uuid(String value)throws Exception{if(value==null||!value.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw error("INVALID_SOURCE_ID");}
    private static void decimal(String value,boolean negative)throws Exception{if(value==null||!value.matches(negative?"-?[0-9]{1,20}":"[0-9]{1,20}"))throw error("MESSAGE_ID_MUST_BE_STRING");}
    private static String clientId(JSONObject value)throws Exception{String id=string(value,"clientId");if(!id.matches("[A-Za-z0-9_:@.-]{1,160}"))throw error("INVALID_CLIENT_ID");return id;}
    private static JSONObject identity(ProductRepository.Tx tx)throws Exception{return tx.getMeta().optJSONObject("identity");}
    private String source(ProductRepository.Tx tx,JSONObject input)throws Exception{
        if(input.has("sourceId")&&!input.isNull("sourceId")){String id=string(input,"sourceId");uuid(id);return id;}
        String room=input.optString("roomId","");String found=null;
        JSONArray records=tx.listEntities();for(int i=0;i<records.length();i++){
            // This branch is migration/bootstrap only; product-source normally passes explicit origin.
            JSONObject record=records.getJSONObject(i),local=record.optJSONObject("local");
            JSONObject data=local==null?null:local.optJSONObject("data");
            if("conversation".equals(record.optString("entityType"))&&data!=null&&room.equals(data.optString("id"))){String candidate=data.optString("sourceId");if(found!=null&&!found.equals(candidate))throw error("AMBIGUOUS_ROOM_ORIGIN");found=candidate;}
        }
        if(found!=null){uuid(found);return found;}
        JSONObject meta=tx.getMeta();String local=meta.optString("chatSourceId019","");
        if(local.isEmpty()){local=UUID.randomUUID().toString();meta.put("chatSourceId019",local);tx.setMeta(meta);}return local;
    }
    private static JSONObject origin(JSONObject data){JSONObject meta=data.optJSONObject("_product"),refs=meta==null?null:meta.optJSONObject("refs");return refs==null?null:refs.optJSONObject("origin");}
    private static JSONObject envelope(String type,String id,JSONObject data,String state)throws Exception{return new JSONObject().put("entityType",type).put("entityId",id).put("revision",0).put("state",state).put("data",state.equals("withdrawn")?new JSONObject():data).put("updatedAt",Instant.now().toString());}
    private static JSONObject messageData(String source,String room,JSONObject original)throws Exception{
        JSONObject data=copy(original),old=data.optJSONObject("_product"),meta=old==null?new JSONObject():copy(old),refs=meta.optJSONObject("refs");refs=refs==null?new JSONObject():copy(refs);
        refs.put("origin",new JSONObject().put("sourceId",source).put("roomId",room)).put("conversation",ProductRepository.productConversationId(source,room));
        refs.put("assets",data.optJSONArray("attachments")==null?new JSONArray():new JSONArray(data.getJSONArray("attachments").toString()));
        data.put("_product",meta.put("schema",1).put("kind","message").put("refs",refs));return data;
    }
    private static void remember(ProductRepository.Tx tx,String source,String room,String id,String sentAt,boolean outgoing)throws Exception{
        String entityId=ProductRepository.productMessageId(source,room,id);ContentValues row=new ContentValues();row.put("entityId",entityId);row.put("sourceId",source);row.put("roomId",room);row.put("messageId",id);if(sentAt==null)row.putNull("sentAt");else row.put("sentAt",sentAt);row.put("outgoing",outgoing?1:0);
        if(tx.database().insertWithOnConflict(IDS,null,row,SQLiteDatabase.CONFLICT_REPLACE)<0)throw error("CHAT_STORAGE");
    }
    private static void bump(ProductRepository.Tx tx)throws Exception{JSONObject m=tx.getMeta();m.put("chatVersion019",m.optLong("chatVersion019",0)+1);tx.setMeta(m);}
    private static JSONObject local(ProductRepository.Tx tx,String type,String id)throws Exception{JSONObject r=tx.getEntity(type,id);return r==null?null:r.optJSONObject("local");}
    public JSONObject listRooms()throws Exception{return repository.transaction(tx->{JSONArray values=new JSONArray(),records=tx.listEntities();for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i),e=r.optJSONObject("local");if("conversation".equals(r.optString("entityType"))&&e!=null&&"active".equals(e.optString("state")))values.put(copy(e));}return new JSONObject().put("rooms",values).put("version",tx.getMeta().optLong("chatVersion019"));});}
    public JSONObject snapshot(JSONObject input)throws Exception{return repository.transaction(tx->{
        String room=string(input,"roomId");decimal(room,true);String source=source(tx,input);int limit=Math.max(1,Math.min(500,input.optInt("limit",80)));
        String conversationId=ProductRepository.productConversationId(source,room);JSONObject conversation=local(tx,"conversation",conversationId);JSONArray records=tx.listEntities();List<JSONObject> messages=new ArrayList<>();
        for(int i=0;i<records.length();i++){
            JSONObject record=records.getJSONObject(i);if(!"chatMessage".equals(record.optString("entityType")))continue;
            JSONObject e=record.optJSONObject("local");if(e==null)continue;JSONObject data=e.optJSONObject("data"),ref=data==null?null:origin(data);String id=null,sentAt=null;boolean outgoing=true;
            if(ref!=null&&source.equals(ref.optString("sourceId"))&&room.equals(ref.optString("roomId"))){id=data.optString("id");sentAt=data.isNull("sentAt")?null:data.optString("sentAt",null);remember(tx,source,room,id,sentAt,!Boolean.FALSE.equals(data.opt("outgoing")));outgoing=!Boolean.FALSE.equals(data.opt("outgoing"));}
            else if("withdrawn".equals(e.optString("state"))){try(Cursor c=tx.database().rawQuery("SELECT messageId,sentAt,outgoing FROM "+IDS+" WHERE entityId=? AND sourceId=? AND roomId=?",new String[]{record.getString("entityId"),source,room})){if(c.moveToFirst()){id=c.getString(0);sentAt=c.isNull(1)?null:c.getString(1);outgoing=c.getInt(2)!=0;}}}
            if(id==null)continue;JSONObject message=data==null?new JSONObject():copy(data);message.put("id",id).put("roomId",room).put("sourceId",source).put("entityId",e.getString("entityId"))
                .put("state",e.getString("state")).put("outgoing",outgoing).put("date",sentAt==null?JSONObject.NULL:sentAt).put("sentAt",sentAt==null?JSONObject.NULL:sentAt)
                .put("kind","withdrawn".equals(e.optString("state"))?"withdrawn":"text").put("text","withdrawn".equals(e.optString("state"))?"":message.optString("text","")).put("replyId",message.opt("replyTo")==null?JSONObject.NULL:message.opt("replyTo"))
                .put("localOnly",record.optBoolean("localOnly")).put("pending",record.has("businessOperationId")&&!record.optBoolean("businessAcknowledged"));
            JSONObject ui=tx.getMapping("chat-message-ui019",e.getString("entityId"));if(ui!=null&&ui.optBoolean("originalSticker"))message.put("originalSticker",true);
            JSONArray attached=message.optJSONArray("attachments");if(attached!=null&&attached.length()>0&&!"withdrawn".equals(message.optString("kind"))){String asset=attached.optString(0);JSONObject media=tx.getMapping("chat-media019",asset);if(media==null)media=tx.getMapping("chat-media-missing019",asset);message.put("mediaId",asset);if(media!=null){if(!media.optBoolean("available"))message.put("mediaPending",true);message.put("mime",media.optString("mime")).put("name",media.optString("name")).put("size",media.optLong("size")).put("sha256",media.optString("sha256"));String mime=media.optString("mime");message.put("kind",mime.startsWith("image/")?"image":mime.startsWith("video/")?"video":"file");}else message.put("kind","file").put("mediaPending",true);}
            messages.add(message);
        }
        messages.sort((a,b)->{int cmp=a.optString("sentAt").compareTo(b.optString("sentAt"));return cmp!=0?cmp:new BigInteger(a.optString("id","0")).compareTo(new BigInteger(b.optString("id","0")));});JSONArray shown=new JSONArray();for(int i=Math.max(0,messages.size()-limit);i<messages.size();i++)shown.put(messages.get(i));
        JSONObject roomData=conversation==null?new JSONObject():conversation.optJSONObject("data");return new JSONObject().put("roomId",room).put("sourceId",source).put("title",roomData==null?input.optString("title","随想"):roomData.optString("title","随想"))
            .put("inConversation",true).put("version",tx.getMeta().optLong("chatVersion019")).put("messages",shown).put("totalMessages",messages.size()).put("hasOlder",messages.size()>limit).put("loadingOlder",false)
            .put("draft",draft(tx,source,room)).put("appearance",roomData==null?new JSONObject():roomData.optJSONObject("configuration")).put("storage","product-sqlite").put("productAuthorityMigrated",true);
    });}
    private JSONObject draft(ProductRepository.Tx tx,String source,String room)throws Exception{try(Cursor c=tx.database().rawQuery("SELECT value,revision FROM "+DRAFTS+" WHERE sourceId=? AND roomId=?",new String[]{source,room})){return c.moveToFirst()?new JSONObject(c.getString(0)).put("revision",c.getLong(1)).put("ready",true):new JSONObject().put("roomId",room).put("sourceId",source).put("text","").put("replyId",JSONObject.NULL).put("revision",0).put("ready",true);}}
    public JSONObject setDraft(JSONObject input)throws Exception{return repository.transaction(tx->{String room=string(input,"roomId");decimal(room,true);String source=source(tx,input);JSONObject current=draft(tx,source,room);long revision=current.getLong("revision");
        if(input.has("expectedDraftRevision")&&input.getLong("expectedDraftRevision")!=revision)throw error("DRAFT_REVISION_CONFLICT");
        if(!(input.opt("text") instanceof String)||input.getString("text").getBytes(StandardCharsets.UTF_8).length>950000)throw error("INVALID_DRAFT");current.put("text",input.getString("text"));
        if(input.has("replyId")){if(!input.isNull("replyId"))decimal(string(input,"replyId"),false);current.put("replyId",input.get("replyId"));}
        current.put("revision",revision+1);ContentValues values=new ContentValues();values.put("sourceId",source);values.put("roomId",room);values.put("value",current.toString());values.put("revision",revision+1);if(tx.database().insertWithOnConflict(DRAFTS,null,values,SQLiteDatabase.CONFLICT_REPLACE)<0)throw error("CHAT_STORAGE");bump(tx);return current;});}
    private static String fingerprint(String action,JSONObject input)throws Exception{return hash(action+"\n"+canonical(input));}
    private static JSONObject existing(ProductRepository.Tx tx,String client,String fingerprint)throws Exception{try(Cursor c=tx.database().rawQuery("SELECT fingerprint,receipt FROM "+OPS+" WHERE clientId=?",new String[]{client})){if(!c.moveToFirst())return null;if(!fingerprint.equals(c.getString(0)))throw error("LOCAL_OPERATION_REUSED");return new JSONObject(c.getString(1));}}
    private static void receipt(ProductRepository.Tx tx,String client,String fingerprint,JSONObject value)throws Exception{ContentValues row=new ContentValues();row.put("clientId",client);row.put("fingerprint",fingerprint);row.put("receipt",value.toString());if(tx.database().insertWithOnConflict(OPS,null,row,SQLiteDatabase.CONFLICT_ABORT)<0)throw error("CHAT_STORAGE");}
    private static void defer(ProductRepository.Tx tx,String id,JSONObject value)throws Exception{tx.putMapping("chat-deferred019",id,value);JSONObject meta=tx.getMeta();JSONArray list=meta.optJSONArray("chatDeferred019");if(list==null)list=new JSONArray();list.put(id);meta.put("chatDeferred019",list);tx.setMeta(meta);}
    public JSONObject send(JSONObject input)throws Exception{return repository.transaction(tx->{
        String room=string(input,"roomId");decimal(room,true);String source=source(tx,input),client=clientId(input),fingerprint=fingerprint("send",input);JSONObject prior=existing(tx,client,fingerprint);if(prior!=null)return prior;
        String text=input.optString("text","");if(!(input.opt("text") instanceof String))throw error("INVALID_MESSAGE_TEXT");if(text.length()>500000)throw error("MESSAGE_TOO_LARGE");JSONArray attachments=input.optJSONArray("attachments");if(attachments==null)attachments=new JSONArray();Set<String> uniqueAssets=new LinkedHashSet<>();for(int n=0;n<attachments.length();n++){if(!(attachments.opt(n) instanceof String))throw error("INVALID_ATTACHMENT_ID");uniqueAssets.add(attachments.getString(n));}attachments=new JSONArray();for(String asset:uniqueAssets)attachments.put(asset);
        if(text.trim().isEmpty()&&attachments.length()==0)throw error("EMPTY_MESSAGE");for(int i=0;i<attachments.length();i++){String id=attachments.getString(i);JSONObject media=tx.getMapping("chat-media019",id);if(media==null||!media.optBoolean("available"))throw error("MEDIA_NOT_READY");}
        String quoted=input.isNull("replyId")||!input.has("replyId")?null:string(input,"replyId");if(quoted!=null)decimal(quoted,false);
        String id=input.has("messageId")?string(input,"messageId"):new BigInteger(66,RANDOM).mod(BigInteger.TEN.pow(20)).toString();decimal(id,false);String eid=ProductRepository.productMessageId(source,room,id);if(tx.getEntity("chatMessage",eid)!=null)throw error("MESSAGE_ID_EXISTS");
        String sentAt=new DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(System.currentTimeMillis()));
        JSONObject message=new JSONObject().put("id",id).put("sentAt",sentAt).put("text",text).put("attachments",attachments);if(quoted!=null)message.put("replyTo",quoted);if(input.optBoolean("originalSticker"))message.put("originalSticker",true);
        JSONObject data=messageData(source,room,message);data.remove("originalSticker");if(input.optBoolean("originalSticker"))tx.putMapping("chat-message-ui019",eid,new JSONObject().put("originalSticker",true));JSONObject envelope=envelope("chatMessage",eid,data,"active");JSONObject payload=new JSONObject().put("sourceId",source).put("roomId",room).put("messages",new JSONArray().put(message));
        if(payload.toString().getBytes(StandardCharsets.UTF_8).length>950000)throw error("MESSAGE_TOO_LARGE");JSONObject bound=identity(tx);String operation;
        if(bound!=null){JSONObject job=tx.enqueueCommand("sendMessages",payload,bound,(same,immutable)->same.putBusinessLocal(envelope,0,immutable.getString("operationId")));operation=job.getString("operationId");}
        else{operation=client;tx.putBusinessLocal(envelope,0,operation);defer(tx,operation,new JSONObject().put("action","sendMessages").put("sourceId",source).put("roomId",room).put("messageIds",new JSONArray().put(id)));}
        remember(tx,source,room,id,message.getString("sentAt"),true);JSONObject result=new JSONObject().put("committed",true).put("flushed",true).put("roomId",room).put("sourceId",source).put("messageId",id).put("messageIds",new JSONArray().put(id)).put("operationId",operation).put("queued",bound!=null).put("localOnly",bound==null).put("storage","product-sqlite");receipt(tx,client,fingerprint,result);bump(tx);return result;
    });}
    public JSONObject withdraw(JSONObject input)throws Exception{return repository.transaction(tx->{String room=string(input,"roomId");decimal(room,true);String source=source(tx,input),id=string(input,"messageId");decimal(id,false);String client=clientId(input),fp=fingerprint("withdraw",input);JSONObject prior=existing(tx,client,fp);if(prior!=null)return prior;String eid=ProductRepository.productMessageId(source,room,id);JSONObject record=tx.getEntity("chatMessage",eid);if(record==null||record.optJSONObject("local")==null)throw error("MESSAGE_NOT_FOUND");JSONObject old=record.getJSONObject("local"),data=old.optJSONObject("data");JSONObject bound=identity(tx);JSONObject tombstone=envelope("chatMessage",eid,new JSONObject(),"withdrawn");long revision=record.optLong("localRevision",0);String sentAt=data==null?null:data.optString("sentAt",null);
        if(!"withdrawn".equals(old.optString("state"))){JSONObject payload=new JSONObject().put("sourceId",source).put("roomId",room).put("messageId",id).put("operationId",client);if(sentAt!=null)payload.put("sentAt",sentAt);
            if(bound!=null)tx.enqueueCommand("withdrawMessage",payload,bound,(same,job)->same.putBusinessLocal(tombstone,revision,job.getString("operationId")));else tx.putBusinessLocal(tombstone,revision,client);remember(tx,source,room,id,sentAt,true);}
        JSONObject result=new JSONObject().put("committed",true).put("roomId",room).put("messageId",id).put("state","withdrawn").put("queued",bound!=null).put("storage","product-sqlite");receipt(tx,client,fp,result);bump(tx);return result;});}
    public JSONObject operation(JSONObject input)throws Exception{return repository.transaction(tx->{String id=clientId(input);try(Cursor c=tx.database().rawQuery("SELECT receipt FROM "+OPS+" WHERE clientId=?",new String[]{id})){return c.moveToFirst()?new JSONObject(c.getString(0)):new JSONObject().put("committed",false);}});}
    /** Native-only call, after the fixed original importer verifies and commits private bytes/hash. */
    public JSONObject registerMedia(JSONObject input)throws Exception{return repository.transaction(tx->registerMedia(tx,input));}
    JSONObject registerMedia(ProductRepository.Tx tx,JSONObject input)throws Exception{JSONObject media=copy(input);String id=media.optString("assetId",media.optString("id"));if(!id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")||!media.optString("sha256").matches("[a-f0-9]{64}")||media.optLong("size")<1||media.optLong("size")>536870912L||media.optString("mime").isEmpty())throw error("INVALID_MEDIA_METADATA");media.put("assetId",id).put("id",id).put("available",true);tx.putMapping("chat-media019",id,media);bump(tx);return media;}
    public JSONObject importLegacyRoom(JSONObject input)throws Exception{return repository.transaction(tx->{String importId=string(input,"importId"),fp=fingerprint("import",input);JSONObject seen=tx.getMapping("chat-import019",importId);if(seen!=null){if(!fp.equals(seen.optString("fingerprint")))throw error("IMPORT_ID_REUSED");return seen;}
        JSONObject room=copy(input.getJSONObject("room"));String source=string(room,"sourceId"),id=string(room,"id");uuid(source);decimal(id,true);String conversationId=ProductRepository.productConversationId(source,id);JSONObject meta=room.optJSONObject("_product");if(meta==null)meta=new JSONObject().put("schema",1).put("kind","conversation").put("refs",new JSONObject().put("origin",new JSONObject().put("sourceId",source).put("roomId",id)));room.put("_product",meta);
        preserve(tx,envelope("conversation",conversationId,room,"active"));JSONArray messages=input.optJSONArray("messages");int imported=0;if(messages!=null)for(int i=0;i<messages.length();i++){JSONObject m=copy(messages.getJSONObject(i));String mid=string(m,"id");decimal(mid,false);if(!m.has("text")&&m.opt("message") instanceof String)m.put("text",m.getString("message"));if(!m.has("replyTo")&&m.has("replyId")&&!m.isNull("replyId"))m.put("replyTo",m.get("replyId"));boolean withdrawn="withdrawn".equals(m.optString("kind"))||"withdrawn".equals(m.optString("state"));String sentAt=m.optString("sentAt",null);JSONObject data=messageData(source,id,m);preserve(tx,envelope("chatMessage",ProductRepository.productMessageId(source,id,mid),data,withdrawn?"withdrawn":"active"));remember(tx,source,id,mid,sentAt,!Boolean.FALSE.equals(m.opt("outgoing")));imported++;}
        JSONObject savedDraft=input.optJSONObject("draft");if(savedDraft!=null){JSONObject existing=draft(tx,source,id);if(existing.optLong("revision")==0){JSONObject value=copy(savedDraft).put("roomId",id).put("sourceId",source).put("revision",1).put("ready",true);ContentValues v=new ContentValues();v.put("sourceId",source);v.put("roomId",id);v.put("value",value.toString());v.put("revision",1);if(tx.database().insertWithOnConflict(DRAFTS,null,v,SQLiteDatabase.CONFLICT_IGNORE)<0)throw error("CHAT_STORAGE");}}
        JSONArray media=input.optJSONArray("mediaMappings");if(media!=null)for(int i=0;i<media.length();i++){JSONObject item=copy(media.getJSONObject(i));String asset=item.optString("assetId",item.optString("mediaId"));if(asset.isEmpty())throw error("INVALID_MEDIA_MAPPING");JSONObject verified=tx.getMapping("chat-media019",asset);if(verified==null)tx.putMapping("chat-media-missing019",asset,item.put("assetId",asset).put("available",false));else if(item.has("sha256")&&!verified.optString("sha256").equals(item.optString("sha256")))throw error("IMPORT_MEDIA_CONFLICT");}
        JSONObject result=new JSONObject().put("committed",true).put("sourceId",source).put("roomId",id).put("imported",imported).put("fingerprint",fp);tx.putMapping("chat-import019",importId,result);bump(tx);return result;
    });}
    private static void preserve(ProductRepository.Tx tx,JSONObject envelope)throws Exception{JSONObject existing=tx.getEntity(envelope.getString("entityType"),envelope.getString("entityId"));if(existing==null)tx.preserveLocalOnly(envelope,0);else{JSONObject local=existing.optJSONObject("local");if(local==null||!canonical(local.opt("data")).equals(canonical(envelope.opt("data")))||!local.optString("state").equals(envelope.optString("state")))throw error("IMPORT_RECORD_CONFLICT");}}
    /** Explicit promotion only, after binding/pairing. It never sends to the network. */
    public JSONObject queueOffline(JSONObject input)throws Exception{return repository.transaction(tx->{JSONObject bound=identity(tx);if(bound==null)throw error("SYNC_IDENTITY_REQUIRED");tx.guardIdentity(bound);JSONObject meta=tx.getMeta();JSONArray pending=meta.optJSONArray("chatDeferred019");if(pending==null)pending=new JSONArray();int queued=0,skipped=0;JSONArray remaining=new JSONArray();int limit=Math.max(1,Math.min(100,input.optInt("limit",100)));
        for(int i=0;i<pending.length();i++){String deferredId=pending.getString(i);if(queued>=limit){remaining.put(deferredId);continue;}JSONObject job=tx.getMapping("chat-deferred019",deferredId);if(job==null)continue;String source=job.getString("sourceId"),room=job.getString("roomId");JSONArray ids=job.getJSONArray("messageIds"),messages=new JSONArray();List<JSONObject> records=new ArrayList<>();for(int n=0;n<ids.length();n++){JSONObject r=tx.getEntity("chatMessage",ProductRepository.productMessageId(source,room,ids.getString(n)));JSONObject e=r==null?null:r.optJSONObject("local");if(e==null||"withdrawn".equals(e.optString("state"))){skipped++;continue;}JSONObject data=e.getJSONObject("data"),wire=copy(data);wire.remove("_product");messages.put(wire);records.add(r);}
            if(messages.length()>0){JSONObject payload=new JSONObject().put("sourceId",source).put("roomId",room).put("messages",messages);tx.enqueueCommand("sendMessages",payload,bound,(same,immutable)->{for(JSONObject r:records)same.putBusinessLocal(r.getJSONObject("local"),r.optLong("localRevision",0),immutable.getString("operationId"));});queued++;}}
        meta=tx.getMeta();meta.put("chatDeferred019",remaining);tx.setMeta(meta);bump(tx);return new JSONObject().put("queued",queued).put("skippedWithdrawn",skipped).put("remaining",remaining.length());});}
    /** Pass to ProductSyncCoordinator.flushPrepared. No fake sync base/revision is generated. */
    public ProductRepository.Receipt receiptHandler(){return (tx,job,receipt)->{String action=job.getString("action");JSONObject input=job.getJSONObject("input");if(action.equals("sendMessages")){JSONArray accepted=receipt.optJSONArray("accepted"),messages=input.getJSONArray("messages");if(accepted==null||accepted.length()!=messages.length())throw error("INVALID_CHAT_RECEIPT");Set<String> ids=new HashSet<>();for(int i=0;i<accepted.length();i++){JSONObject ack=accepted.getJSONObject(i);String id=string(ack,"id");decimal(id,false);ids.add(id);if(ack.opt("entryId") instanceof String)tx.putMapping("chat-entry019",ProductRepository.productMessageId(input.getString("sourceId"),input.getString("roomId"),id),new JSONObject().put("entryId",ack.getString("entryId")));}for(int i=0;i<messages.length();i++){String id=messages.getJSONObject(i).getString("id");if(!ids.contains(id))throw error("INVALID_CHAT_RECEIPT");tx.markBusinessAcknowledged("chatMessage",ProductRepository.productMessageId(input.getString("sourceId"),input.getString("roomId"),id),job.getString("operationId"));}}
        else if(action.equals("withdrawMessage")){if(!input.getString("messageId").equals(receipt.opt("id"))||!"withdrawn".equals(receipt.optString("state")))throw error("INVALID_CHAT_RECEIPT");tx.markBusinessAcknowledged("chatMessage",ProductRepository.productMessageId(input.getString("sourceId"),input.getString("roomId"),input.getString("messageId")),job.getString("operationId"));}bump(tx);};}
    private static String hash(String text)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    private static String canonical(Object value)throws Exception{if(value instanceof JSONObject){JSONObject o=(JSONObject)value;List<String>keys=new ArrayList<>();for(Iterator<String>i=o.keys();i.hasNext();)keys.add(i.next());Collections.sort(keys);StringBuilder s=new StringBuilder("{");for(String key:keys){if(s.length()>1)s.append(',');s.append(JSONObject.quote(key)).append(':').append(canonical(o.get(key)));}return s.append('}').toString();}if(value instanceof JSONArray){StringBuilder s=new StringBuilder("[");JSONArray a=(JSONArray)value;for(int i=0;i<a.length();i++){if(i>0)s.append(',');s.append(canonical(a.get(i)));}return s.append(']').toString();}return value==null||value==JSONObject.NULL?"null":value instanceof String?JSONObject.quote((String)value):String.valueOf(value);}
}
