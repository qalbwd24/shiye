/* Read-only, current-editor diary action coordinator. Trash is deliberately absent. */
export const DIARY_ACTION_IDS = Object.freeze([
  'copyAll',
  'exportTxt',
  'exportPdf',
  'shareText',
]);

export function diaryActionOrder(value) {
  if (
    !Array.isArray(value) ||
    value.some((id) => !DIARY_ACTION_IDS.includes(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error('常用操作配置无效');
  return [...value];
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
/** Host injects existing rich schema/render algorithms and the current, complete editor capture. */
export function createDiaryActions({
  capture,
  validate,
  documentNode,
  render,
  native,
}) {
  let busy = false;
  function snapshot() {
    const source = capture();
    if (
      !source ||
      typeof source.owner !== 'string' ||
      !source.owner ||
      typeof source.id !== 'string' ||
      !source.id ||
      !Number.isSafeInteger(source.generation) ||
      source.generation < 0 ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 0 ||
      source.composing ||
      typeof source.title !== 'string' ||
      typeof source.date !== 'string' ||
      source.complete !== true ||
      source.contentFormat !== 'richdoc'
    )
      throw new Error('请等待完整正文和当前组词就绪');
    const snap = clone(source);
    validate(snap.body); // validateRenderableRichDocument, never permissive format downgrade.
    return snap;
  }
  function text(snap) {
    const doc = documentNode(snap.body); // Existing schema.nodeFromJSON(toEditorJSON(body)).
    const body = doc.textBetween(0, doc.content.size, '\n', (node) => {
      if (node.type.name === 'hardBreak') return '\n';
      if (node.type.name === 'horizontalRule') return '───';
      if (node.type.name === 'image' || node.type.name === 'video')
        return `${node.type.name === 'image' ? '［图片］' : '［视频］'}${node.attrs.caption || node.attrs.alt || ''}`;
      return '';
    });
    return [snap.title || '', snap.date || '', '', body].join('\n');
  }
  async function run(action) {
    if (!DIARY_ACTION_IDS.includes(action) || busy) throw new Error('操作无效或尚未完成');
    busy = true;
    try {
      const snap = snapshot();
      const fullText = text(snap);
      if (new TextEncoder().encode(fullText).length > 2_500_000)
        throw new Error('本篇内容超过当前系统出口容量，请分段处理。');
      if (action === 'copyAll') return await native.copy(fullText, snap);
      if (action === 'exportTxt')
        return await native.saveTxt({ name: `${snap.title || '思绪'}.txt`, text: fullText }, snap);
      if (action === 'shareText')
        return await native.shareText({ title: snap.title || '思绪', text: fullText }, snap);
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'"><title>${escape(snap.title || '思绪')}</title><style>@page{size:A4;margin:18mm}body{font:12pt sans-serif;overflow-wrap:anywhere}h1{font-size:20pt}p,pre{white-space:pre-wrap}img{max-width:100%;height:auto}figure{break-inside:avoid}thead{display:table-header-group}video{display:none}figure[data-rich-video]::before{content:'［视频］'}</style></head><body><h1>${escape(snap.title || '')}</h1><p>${escape(snap.date || '')}</p>${render(snap.body)}</body></html>`;
      if (new TextEncoder().encode(html).length > 2_500_000)
        throw new Error('本篇排版超过当前打印出口容量，请分段处理。');
      return await native.printDocument({ title: snap.title || '思绪', html, snapshot: snap });
    } finally {
      busy = false;
    }
  }
  return Object.freeze({ run, snapshot, text, canTrash: () => false });
}
