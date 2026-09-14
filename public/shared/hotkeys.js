export const commands = [
  { id: 'new', name: '新建日记', group: '日记', default: 'Alt+N', scope: 'global' },
  { id: 'search', name: '搜索日记', group: '导航', default: 'Ctrl+K', scope: 'global' },
  { id: 'save', name: '立即保存', group: '日记', default: 'Ctrl+S', scope: 'global' },
  { id: 'focus', name: '切换专注写作', group: '视图', default: 'F9', scope: 'global' },
  { id: 'calendar', name: '打开日历', group: '导航', default: 'Alt+C', scope: 'global' },
  { id: 'gallery', name: '打开相册', group: '导航', default: 'Alt+G', scope: 'global' },
  { id: 'memories', name: '打开随机回忆', group: '导航', default: 'Alt+R', scope: 'global' },
  { id: 'stats', name: '打开记录统计', group: '导航', default: 'Alt+S', scope: 'global' },
  { id: 'bold', name: '粗体', group: '正文编辑', default: 'Ctrl+B', scope: 'editor' },
  { id: 'italic', name: '斜体', group: '正文编辑', default: 'Ctrl+I', scope: 'editor' },
  { id: 'strike', name: '删除线', group: '正文编辑', default: 'Ctrl+Shift+X', scope: 'editor' },
  { id: 'list', name: '项目列表', group: '正文编辑', default: 'Ctrl+Shift+L', scope: 'editor' },
  { id: 'quote', name: '引用段落', group: '正文编辑', default: 'Ctrl+Shift+Q', scope: 'editor' },
  { id: 'heading', name: '二级标题', group: '正文编辑', default: 'Ctrl+Alt+2', scope: 'editor' },
  { id: 'datetime', name: '插入日期和时间', group: '正文编辑', default: 'Alt+T', scope: 'editor' },
  { id: 'indent', name: '空两格', group: '正文编辑', default: 'Tab', scope: 'editor' },
  { id: 'template', name: '插入写作模板', group: '正文编辑', default: 'Alt+M', scope: 'editor' },
  { id: 'history', name: '打开编辑历史', group: '日记', default: 'Alt+H', scope: 'global' },
  { id: 'backup', name: '备份与导入', group: '数据', default: 'Ctrl+Shift+E', scope: 'global' },
  { id: 'shortcuts', name: '打开快捷键设置', group: '设置', default: 'Ctrl+,', scope: 'global' },
];
export function chord(e) {
  if (
    ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Unidentified', 'Process', 'Dead'].includes(
      e.key,
    ) ||
    e.isComposing ||
    e.keyCode === 229
  )
    return null;
  const key = e.code?.startsWith('Key')
    ? e.code.slice(3)
    : e.code?.startsWith('Digit')
      ? e.code.slice(5)
      : e.key === ' '
        ? 'Space'
        : e.key.length === 1
          ? e.key.toUpperCase()
          : e.key;
  return [
    e.ctrlKey ? 'Ctrl' : null,
    e.altKey ? 'Alt' : null,
    e.shiftKey ? 'Shift' : null,
    e.metaKey ? 'Meta' : null,
    key,
  ]
    .filter(Boolean)
    .join('+');
}
export const binding = (c, settings) =>
  Object.hasOwn(settings || {}, c.id) ? settings[c.id] : c.default;
export function conflicts(value, id, settings) {
  return commands.filter((c) => c.id !== id && value && binding(c, settings) === value);
}
export function match(event, settings, inEditor, typing) {
  const value = chord(event);
  if (!value) return undefined;
  return commands.find(
    (c) =>
      binding(c, settings) === value &&
      (c.scope !== 'editor' || inEditor) &&
      (!typing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        inEditor ||
        /^F\d+$/.test(event.key)),
  );
}
