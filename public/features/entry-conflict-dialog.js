import { getEditorDocument } from '../shared/editor-document.js';

/** Text and local media references only. No HTML body is executed in the comparison. */
export function chooseEntryConflict(local, saved) {
  const dialog = document.createElement('dialog');
  dialog.className = 'entry-conflict-dialog';
  const make = (tag, text, parent = dialog) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  const heading = make('h2', '两边有不同内容');
  heading.id = 'entry-conflict-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  make('p', '两边的修改无法直接合并。请选择保留方式；覆盖前的已保存内容会留在历史中。');
  const columns = make('div');
  columns.className = 'entry-conflict-columns';
  for (const [label, entry] of [
    ['本窗口内容', local],
    ['已保存内容', saved],
  ]) {
    const section = make('section', undefined, columns);
    make('h3', label, section);
    make('strong', entry.title || '无标题日记', section);
    make('p', `日期：${entry.date} · 分类：${entry.category}`, section);
    make(
      'p',
      `标签：${(entry.tags || []).join('、') || '无'} · 天气/心情/地点：${[entry.weather, entry.mood, entry.location].filter(Boolean).join(' / ') || '无'}`,
      section,
    );
    const doc = getEditorDocument(entry);
    const body =
      doc.format === 'markdown'
        ? doc.source
        : new DOMParser().parseFromString(doc.source, 'text/html').body.textContent;
    make('pre', body || '（正文空白）', section);
    make(
      'p',
      `附件 ${entry.attachments.length} 个（按顺序）：${entry.attachments.join(' → ') || '无'}`,
      section,
    );
    make('small', `版本 ${entry.revision} · ${entry.updatedAt || '尚未保存'}`, section);
  }
  const label = make('label', '另存一篇时的标题');
  const title = make('input', undefined, label);
  title.className = 'field';
  title.value = local.title || '';
  title.maxLength = 500;
  const footer = make('footer');
  let resolve;
  const result = new Promise((done) => {
    resolve = done;
  });
  const finish = (value) => {
    dialog.close();
    dialog.remove();
    resolve(value);
  };
  for (const [text, action] of [
    ['暂不处理', null],
    ['使用已保存内容', 'saved'],
    ['两份都保留', 'keep-both'],
    ['使用本窗口内容', 'keep-local'],
  ]) {
    const button = make('button', text, footer);
    button.className = 'secondary';
    button.onclick = () =>
      finish(action ? { action, title: action === 'keep-both' ? title.value : local.title } : null);
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(null);
  });
  document.body.append(dialog);
  dialog.showModal();
  footer.firstElementChild.focus();
  return result;
}
