import { createHash } from 'node:crypto';

export const STYLE_ID = 'shiye-android-live-preview';
export const SHADOW_STYLE_ID = 'shiye-android-live-preview-qq';
export const SOURCES = {
  chat: 'android/telegram-adapter/android-chat.css',
  editor: 'android/app/src/main/assets/editor.css',
};
export const EXTRA_SOURCES = {
  editor: 'android/ui-refinement-019/editor.css',
  chat: 'android/qq-chat/view.css',
};
export const PIXEL_FIELDS = Object.freeze({
  '--body-size': [8, 40],
  '--shiye-list-avatar-size': [40, 56],
  '--shiye-list-title-size': [14, 22],
  '--shiye-list-preview-size': [12, 18],
  '--shiye-list-time-size': [10, 14],
});
export function variableControl(name) {
  const bounds = Object.hasOwn(PIXEL_FIELDS, name) ? PIXEL_FIELDS[name] : null;
  return bounds
    ? { type: 'number', min: bounds[0], max: bounds[1], step: 1, unit: 'px' }
    : { type: 'text', unit: '' };
}
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function pageKind(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://appassets.androidplatform.net') return null;
    return { '/telegram/index.html': 'chat', '/editor.html': 'editor' }[url.pathname] ?? null;
  } catch {
    return null;
  }
}
export function endpoint(value, port) {
  const ws = new URL(value);
  if (
    ws.protocol !== 'ws:' ||
    !['localhost', '127.0.0.1'].includes(ws.hostname) ||
    !/^\/devtools\/page\/[^/]+$/.test(ws.pathname) ||
    ws.search ||
    ws.hash ||
    ws.username ||
    ws.password
  )
    throw Error('Unsafe DevTools endpoint');
  ws.hostname = '127.0.0.1';
  ws.port = String(port);
  return ws.href;
}
export function variables(css) {
  const root = css.match(/:root\s*\{([^}]+)\}/)?.[1] ?? '';
  return Object.fromEntries(
    [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .filter(([, name, value]) => validValue(name, value.trim()))
      .map(([, name, value]) => [name, value.trim()]),
  );
}
export function validValue(name, value) {
  if (typeof value !== 'string') return false;
  if (Object.hasOwn(PIXEL_FIELDS, name)) {
    if (!/^\d+px$/.test(value)) return false;
    const number = Number(value.slice(0, -2));
    const [min, max] = PIXEL_FIELDS[name];
    return Number.isInteger(number) && number >= min && number <= max;
  }
  return /^#[\da-f]{3,4}$/i.test(value) || /^#[\da-f]{6}([\da-f]{2})?$/i.test(value);
}
export function checkedOverrides(css, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw Error('Expected variable object');
  const known = variables(css);
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(known, name) || !validValue(name, value))
      throw Error(`Unsupported variable/value: ${name}`);
  }
  return values;
}
export function previewCss(css, values) {
  checkedOverrides(css, values);
  const overlay = Object.entries(values)
    .map(([name, value]) => `${name}:${value}!important;`)
    .join('');
  return css + (overlay ? `\n:root{${overlay}}` : '');
}
export function layeredPreviewCss(base, overlay, values) {
  checkedOverrides(base, values);
  const override = Object.entries(values)
    .map(([name, value]) => `${name}:${value}!important;`)
    .join('');
  return `${base}\n${overlay}${override ? `\n:root{${override}}` : ''}`;
}
export function replaceVariables(css, values) {
  checkedOverrides(css, values);
  return css.replace(
    /(:root\s*\{)([^}]+)(\})/,
    (_, start, body, end) =>
      start +
      body.replace(/(--[\w-]+)(\s*:\s*)([^;]+)(;)/g, (full, name, gap, _value, semicolon) =>
        Object.hasOwn(values, name) ? name + gap + values[name] + semicolon : full,
      ) +
      end,
  );
}
export function injectionExpression({ kind, css, shadowCss = '', owner, sourceHash, enabled }) {
  return `(()=>{if(location.origin!=='https://appassets.androidplatform.net'||location.pathname!==${JSON.stringify(kind === 'chat' ? '/telegram/index.html' : '/editor.html')})throw Error('Page changed; injection refused');let shadow=null;if(${JSON.stringify(kind)}==='chat'){try{const frame=document.querySelector('#shiye-qq-chat iframe');if(frame?.contentWindow?.location?.origin===location.origin)shadow=frame.contentDocument?.querySelector('#qq-frame-root')?.shadowRoot??null}catch{shadow=null}}let s=document.getElementById(${JSON.stringify(STYLE_ID)}),q=shadow?.getElementById(${JSON.stringify(SHADOW_STYLE_ID)})??null;if((s&&s.dataset.owner!==${JSON.stringify(owner)})||(q&&q.dataset.owner!==${JSON.stringify(owner)}))throw Error('Another preview session owns this page');if(!${Boolean(enabled)}){s?.remove();q?.remove();return {enabled:false,shadow:!!shadow}}if(!s){s=document.createElement('style');s.id=${JSON.stringify(STYLE_ID)};s.dataset.owner=${JSON.stringify(owner)};document.head.append(s)}if(s.textContent!==${JSON.stringify(css)})s.textContent=${JSON.stringify(css)};s.dataset.sourceHash=${JSON.stringify(sourceHash)};if(shadow){if(!q){q=shadow.ownerDocument.createElement('style');q.id=${JSON.stringify(SHADOW_STYLE_ID)};q.dataset.owner=${JSON.stringify(owner)};shadow.append(q)}if(q.textContent!==${JSON.stringify(shadowCss)})q.textContent=${JSON.stringify(shadowCss)};q.dataset.sourceHash=${JSON.stringify(sourceHash)}}return {enabled:true,hash:s.dataset.sourceHash,count:document.querySelectorAll('#'+${JSON.stringify(STYLE_ID)}).length,shadow:!!q,shadowCount:shadow?.querySelectorAll('#'+${JSON.stringify(SHADOW_STYLE_ID)}).length??0}})()`;
}
export function hasOwnedForward(listing, serial, pid, port) {
  return listing.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/);
    return (
      fields[0] === serial &&
      fields[1] === `tcp:${port}` &&
      fields[2] === `localabstract:webview_devtools_remote_${pid}`
    );
  });
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      clearTimeout(task.timer);
      if (message.error) task.reject(Error(message.error.message));
      else task.resolve(message.result);
    });
    ws.addEventListener('close', () => {
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(Error('CDP disconnected'));
      }
      this.pending.clear();
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(Error('CDP connect timeout'));
      }, 4000);
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(Error('CDP connection failed'));
        },
        { once: true },
      );
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(Error('CDP disconnected'));
        return;
      }
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`CDP timeout: ${method}`));
      }, 4000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails)
      throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() {
    this.ws.close();
  }
}
