// Only opens the packaged test view on the guarded QA WebView. No arbitrary evaluation/URL.
if(process.argv.length!==2)throw Error('No CDP arguments/URL/evaluation overrides');
const list=await fetch('http://127.0.0.1:19482/json/list').then(r=>{if(!r.ok)throw Error('QA_CDP_UNAVAILABLE');return r.json();});
const targets=list.filter(t=>{try{const u=new URL(t.url);return t.type==='page'&&u.origin==='https://appassets.androidplatform.net'&&u.pathname==='/telegram/index.html';}catch{return false;}});
if(targets.length!==1)throw Error('QA_EXACT_FROZEN_WEBVIEW_REQUIRED');
const address=new URL(targets[0].webSocketDebuggerUrl);
if(!['127.0.0.1','localhost'].includes(address.hostname)||address.port!=='19482'||address.protocol!=='ws:')throw Error('QA_CDP_ADDRESS_MISMATCH');
const socket=new WebSocket(address),timer=setTimeout(()=>{socket.close();throw Error('QA_CDP_TIMEOUT');},25000);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
const result=await new Promise((resolve,reject)=>{
 socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id!==1)return;if(m.error||m.result?.exceptionDetails)reject(Error('QA_DATA_VIEW_OPEN_FAILED'));else resolve(m.result?.result?.value);};
 socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:"import('/telegram/qq-chat/fullseed-data-qa.js').then(async m=>{await m.openFullSeedDataQa();return window.shiyeFullSeedQA.refresh();})",awaitPromise:true,returnByValue:true}}));
});
clearTimeout(timer);socket.close();
if(!result||result.networkLocked!==true||!result.persistedByType)throw Error('QA_DATA_VIEW_SUMMARY_REQUIRED');
console.log(JSON.stringify(result));
