import {createSharedRuntime,readSharedRuntimeConfig} from './shared-runtime.js';

const bodySupported=data=>!data.chatJournal&&!data.hidden&&!data.deleted&&!data.draft&&typeof data.content==='string'&&(!data.contentFormat||data.contentFormat==='html')&&data.body===undefined&&(data.markdownSource===undefined||data.markdownSource===null);
const bodyDraft=row=>row?.value?.selectionAnchor?.qaFullSeedBodyV1;
const escapeHtml=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** QA-only: append plain text to complete HTML, preserving all other Entry fields/originals. */
export async function prepareQaBodyDraft(runtime,id,note){
  const record=await runtime.diary.read(id),data=record.local.data;
  if(!bodySupported(data))throw Error('QA_BODY_FORMAT_UNSUPPORTED');
  if(typeof note!=='string'||!note.trim()||note.length>4096)throw Error('QA_NOTE_1_TO_4096_REQUIRED');
  const content=data.content+'<p>'+escapeHtml(note)+'</p>';
  if(content.length>2000000)throw Error('QA_BODY_SIZE_LIMIT');
  const prior=await runtime.diary.readDraftState(id);
  if(prior?.value&&!bodyDraft(prior))throw Error('QA_EXISTING_USER_DRAFT_PRESERVED');
  if(bodyDraft(prior)&&prior.value.body===content&&prior.baseLocalRevision===record.localRevision)return prior;
  const operationId=crypto.randomUUID();
  return runtime.diary.saveDraft(id,{format:'html',body:content,mediaRefs:[],selectionAnchor:{qaFullSeedBodyV1:{operationId,baseLocalRevision:record.localRevision}}},{expectedDraftRevision:prior?.revision||0,baseLocalRevision:record.localRevision});
}
export async function commitQaBodyDraft(runtime,id){
  const draft=await runtime.diary.readDraftState(id),frozen=bodyDraft(draft);
  if(!frozen||draft.value.format!=='html'||typeof draft.value.body!=='string')throw Error('QA_PERSISTED_BODY_DRAFT_REQUIRED');
  const existing=await runtime.client.readOperation(frozen.operationId);
  if(existing){
    const current=await runtime.diary.read(id);
    if(!['pending','acknowledged'].includes(existing.status)||current.local.data.content!==draft.value.body)throw Error('QA_OPERATION_MAPPING_MISMATCH');
    return {operationId:frozen.operationId,localAck:true,replayed:true,status:existing.status};
  }
  const record=await runtime.diary.read(id);
  if(!bodySupported(record.local.data))throw Error('QA_BODY_FORMAT_UNSUPPORTED');
  if(record.localRevision!==frozen.baseLocalRevision)throw Error('QA_BODY_BASE_CHANGED_DRAFT_PRESERVED');
  return runtime.diary.save(id,{content:draft.value.body,contentFormat:'html',markdownSource:null,markdownHtml:null},frozen.baseLocalRevision,{sync:false,operationId:frozen.operationId});
}

/** Test-only on-device data view. Same owner/IDB; never a Product copy or remote writer. */
export async function openFullSeedDataQa(){
  if(document.getElementById('shiye-fullseed-data-qa'))return;
  const config=readSharedRuntimeConfig();
  if(!config)throw Error('QA_ACTIVE_IMPORTED_LIBRARY_REQUIRED');
  const runtime=await createSharedRuntime({config,currentRoom:()=>null,nativeRequest:(action,input)=>{
    if(action!=='sharedSeedOriginalRead')throw Object.assign(Error('QA_REMOTE_NETWORK_LOCKED'),{code:'QA_REMOTE_NETWORK_LOCKED'});
    return window.shiyeSharedImportRequest(action,input);
  }});
  const root=document.createElement('section');root.id='shiye-fullseed-data-qa';root.setAttribute('role','dialog');
  Object.assign(root.style,{position:'fixed',inset:'0',zIndex:'100001',overflow:'auto',padding:'16px',background:'white',color:'#14212b',fontSize:'16px'});
  const node=(tag,text,parent=root)=>{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;};
  const status=node('p','只读盘点中…'),counts=node('pre',''),list=node('div',''),detail=node('div','');let url=null,summary=null;
  const button=(text,fn,parent=root)=>{const b=node('button',text,parent);b.onclick=()=>Promise.resolve().then(fn).catch(e=>{status.textContent=e.code||e.message;});b.style.minHeight='44px';return b;};
  node('h2','完整资料 · Data QA（非原生日记主页）');
  node('p','同一共享客户端库；本页永久禁止网络同步。修改仅保存在本机outbox，后续只准连接隔离clone。');
  async function countTypes(){
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(`shiye-sync-v2-shared-${config.libraryId}-${config.epoch}`);request.onupgradeneeded=()=>{request.transaction.abort();reject(Error('QA_EXISTING_DB_REQUIRED'));};request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction('entities','readonly'),index=tx.objectStore('entities').index('entityType'),values={};const cursor=index.openKeyCursor(null,'nextunique');cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const type=c.key,r=index.count(type);r.onsuccess=()=>{values[type]=r.result;c.continue();};};tx.oncomplete=()=>resolve(values);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('QA_COUNT_ABORT'));});}finally{db.close();}
  }
  async function refresh(){const state=await runtime.client.status();summary={libraryId:config.libraryId,epoch:config.epoch,initialized:state.initialized===true,pinned:Boolean(state.sharedLibraryTrust),keyFingerprintSha256:state.sharedLibraryTrust?.keyFingerprintSha256||null,persistedByType:await countTypes(),pending:state.pending,networkLocked:true};counts.textContent=JSON.stringify(summary,null,2);status.textContent='本机持久记录已按实体类型全量计数（含各状态；staging单列），未读取全部正文或原件。';return summary;}
  let cursor;
  async function page(reset=false){if(reset)cursor=undefined;const result=await runtime.diary.listPage({limit:40,...(cursor?{cursor}:{})});list.replaceChildren();for(const row of result.items)button(row.title||row.id,()=>read(row.id),list);cursor=result.nextCursor;if(result.hasMore)button('下一页40项',()=>page(),list);}
  async function read(id){const record=await runtime.diary.read(id),data=record.local.data;detail.replaceChildren();node('h3',data.title||id,detail);node('pre',JSON.stringify(data,null,2).slice(0,262144),detail);node('p','本项正文显示上限256KiB；未因此截断存储。',detail);
    if(bodySupported(data)){
      node('p','受控正文测试：仅在完整HTML末尾追加转义纯文字，保留原字段/附件。草稿及操作ID均持久保存在同库；不联网。',detail);
      const note=node('textarea','',detail);note.maxLength=4096;note.setAttribute('aria-label','仅本机QA正文追加文字');
      const draft=await runtime.diary.readDraftState(id),frozen=bodyDraft(draft);
      node('p',frozen?'已持久QA正文草稿；operationId '+frozen.operationId:'尚无QA正文草稿',detail);
      button('持久保存QA正文草稿',async()=>{const saved=await prepareQaBodyDraft(runtime,id,note.value);status.textContent='草稿本机ACK；operationId '+bodyDraft(saved).operationId;},detail);
      button('提交已存正文草稿（仅本机）',async()=>{const ack=await commitQaBodyDraft(runtime,id);if(ack.localAck!==true)throw Error('QA_LOCAL_ACK_REQUIRED');await refresh();status.textContent='正文本机ACK；operationId '+ack.operationId+'；远端未发送，可冷开同ID回读。';},detail);
    }else node('p','QA_BODY_FORMAT_UNSUPPORTED：此格式或只读状态不提供测试正文修改；原字段/草稿/原件保持。',detail);
    for(const assetId of data.attachments||[])button('按需读取原件 '+assetId,()=>original(assetId),detail);
  }
  async function original(assetId){const original=await runtime.seed.openOriginal(assetId);if(!original)throw Error('QA_ORIGINAL_NOT_LOCAL');const first=await original.read(0,Math.min(original.size,262144));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',first))).map(b=>b.toString(16).padStart(2,'0')).join('');status.textContent=`本机原件 ${original.size}B；首块 ${first.length}B；首块SHA256 ${digest}`;
    const media=await runtime.client.read('media',assetId),mime=media?.local?.data?.mime||media?.local?.data?.type||'';
    if(mime.startsWith('image/')&&original.size<=16*1024*1024){const parts=[];for(let offset=0;offset<original.size;offset+=262144)parts.push(await original.read(offset,Math.min(original.size,offset+262144)));if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob(parts,{type:mime}));const img=node('img','',detail);img.src=url;img.style.maxWidth='100%';img.alt='本机原件预览';}
  }
  button('刷新本机计数',refresh);button('分页查看本机思绪',()=>page(true));
  button('关闭Data QA',async()=>{if(url)URL.revokeObjectURL(url);await runtime.dispose();root.remove();delete window.shiyeFullSeedQA;});
  document.body.append(root);window.shiyeFullSeedQA={summary:()=>structuredClone(summary),refresh};await refresh();
}
