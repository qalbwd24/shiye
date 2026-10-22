import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export class Channel {
  static messages = [];
  static instances = [];
  static skipAck = false;
  constructor(name) {
    this.name = name;
    Channel.instances.push(this);
  }
  postMessage(value) {
    Channel.messages.push({ name: this.name, value });
    if (value.action === 'withdrawal-ack' && Channel.skipAck) {
      Channel.skipAck = false;
      return;
    }
    for (const other of Channel.instances) {
      if (other !== this && other.name === this.name) {
        queueMicrotask(() => other.onmessage?.({ data: structuredClone(value) }));
      }
    }
  }
}
const apiStub = `class DeleteMessages { constructor(value) { Object.assign(this,value); } }
class ChannelDeleteMessages extends DeleteMessages {}
class SendMessage { constructor(value) { Object.assign(this,value); } }
class AffectedMessages { constructor(value) { Object.assign(this,value); } }
const names=['GetLangPack','GetDifference','GetLanguage','GetFullUser','GetChats','GetFullChat','GetUsers','GetState','SaveFilePart','SaveBigFilePart','UploadMedia','GetFile','SendMedia','SaveDraft','ReadHistory','SetTyping','InputReplyToMessage','PeerUser','UpdateShortSentMessage','UpdateNewMessage','UpdateEditMessage','DocumentAttributeFilename','Updates'];
const unused=Object.fromEntries(names.map(name=>[name,class { constructor(value) { Object.assign(this,value); } }]));
export default { ...unused, messages:{...unused,DeleteMessages,SendMessage,AffectedMessages},channels:{DeleteMessages:ChannelDeleteMessages},langpack:unused,users:unused,updates:unused,upload:unused };
export { DeleteMessages, ChannelDeleteMessages, SendMessage };
`;
export async function loadWorker() {
  Channel.instances = [];
  Channel.messages = [];
  Channel.skipAck = false;
  globalThis.indexedDB = new IDBFactory();
  globalThis.BroadcastChannel = Channel;
  const base = path.join(ROOT, 'previews/telegram-chat/vendor/web-a/src/lib/gramjs/client');
  const result = await build({
    stdin: {
      contents: [
        'export *',
        'from',
        JSON.stringify('./shiyeLocal') + ';',
        'export { default as Api }',
        'from',
        JSON.stringify('../tl/api') + ';',
        'export * from "../../../util/shiyeSendIdentity";',
      ].join(' '),
      resolveDir: base,
      sourcefile: 'withdrawal-test.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'inert-dependencies',
        setup(b) {
          b.onResolve(
            {
              filter:
                /(?:tl\/api$|readStrings$|createMockedChat$|createMockedMessage$|createMockedMessageMedia$|createMockedUser$|getIdFromInputPeer$|fallback\.strings\?raw$)/,
            },
            (args) => ({ path: args.path, namespace: 'inert' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'inert' }, (args) => ({
            contents: args.path.endsWith('tl/api')
              ? apiStub
              : args.path.endsWith('createMockedMessage')
                ? 'export default (room,id,data)=>data.messages[room].find(item=>item.id===id);'
                : args.path.endsWith('getIdFromInputPeer')
                  ? 'export default peer=>peer.roomId;'
                  : 'export default ()=>({});',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  // Actual local worker mutation/persistence code; only Telegram builders are inert.
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(code + `\n// ${crypto.randomUUID()}`).toString('base64')
  );
}

export async function loadJournal(handler, configuration) {
  if (configuration) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('shiye-journal-link-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('settings', 'readwrite');
        transaction.objectStore('settings').put(configuration, 'link');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
  }
  let listener;
  const window = {
    chrome: {
      webview: {
        addEventListener(_name, value) {
          listener = value;
        },
        postMessage(request) {
          Promise.resolve()
            .then(() => handler(request))
            .then(
              (data) => {
                listener({ data: { kind: 'journal-result', id: request.id, result: data } });
              },
              (error) => {
                listener({
                  data: { kind: 'journal-result', id: request.id, error: error.message },
                });
              },
            );
        },
      },
    },
    dispatchEvent() {},
  };
  runInNewContext(
    await fs.readFile(path.join(ROOT, 'previews/telegram-chat/shiye-journal.js'), 'utf8'),
    {
      window,
      indexedDB,
      crypto,
      structuredClone,
      BroadcastChannel: Channel,
      Event,
      TextEncoder,
      Uint8Array,
      btoa,
      setTimeout(callback, milliseconds) {
        if (milliseconds === 2000) return 0; // Disable automatic polling; explicit flush only.
        return setTimeout(callback, milliseconds === 10000 ? 20 : milliseconds);
      },
      clearTimeout,
      setInterval() {},
    },
  );
  return window.shiyeJournal;
}
