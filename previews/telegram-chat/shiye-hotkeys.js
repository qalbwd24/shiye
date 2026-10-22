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

// Keep saved custom bindings intact, but require explicit opt-in before they run.
export function effectiveShortcuts(settings, enabled = false) {
  return enabled
    ? settings || {}
    : Object.fromEntries(commands.map((c) => [c.id, c.id === 'datetime' ? 'Alt+T' : null]));
}

export function pausedShortcut(event, settings, enabled = false) {
  if (enabled) return false;
  if (event.getModifierState?.('AltGraph')) return false;
  const value = chord(event);
  // Basic text editing, focus navigation, dialog keys and IME remain native.
  if (!value || ['Tab', 'Escape', 'Enter', 'Alt+T'].includes(value)) return false;
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/.test(event.key)) return false;
  if (/^(Ctrl|Meta)\+(A|C|V|X|Z|Y|Shift\+Z|Shift\+V)$/.test(value)) return false;
  return (
    commands.some(
      (c) => c.id !== 'datetime' && (c.default === value || binding(c, settings) === value),
    ) ||
    (settings?.datetime && settings.datetime !== 'Alt+T' && settings.datetime === value) ||
    /^(Ctrl\+)?Alt\+(Shift\+)?Arrow(Up|Down|Left|Right)$/.test(value) ||
    [
      'Alt+ArrowLeft',
      'Alt+ArrowRight',
      'Alt+ArrowUp',
      'Alt+ArrowDown',
      'Alt+Shift+ArrowUp',
      'Alt+Shift+ArrowDown',
      'Ctrl+Alt+ArrowUp',
      'Ctrl+Alt+ArrowDown',
      'Ctrl+Enter',
      'Alt+L',
      'Ctrl+[',
      'Ctrl+]',
      'Ctrl+Alt+\\',
      'Ctrl+Shift+K',
      'Ctrl+Shift+\\',
      'Ctrl+/',
      'Alt+A',
      'Ctrl+M',
      'Ctrl+U',
      'Alt+U',
    ].includes(value)
  );
}
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

// Native resident-window commands use their own host, outside web-page key handlers.
export const desktopWindowCommands = Object.freeze([
  {
    id: 'chat-window',
    name: '唤回／收起随想并定位输入末尾',
    default: 'F15',
    scope: 'desktop',
    configurableKeys: 'F13–F24',
  },
]);

// Independent notes UI; these bindings never install global desktop hotkeys.
export const notesWorkspaceCommands = Object.freeze([
  { id: 'new-note', name: '新建便签', default: 'Ctrl+T', aliases: ['Ctrl+N'], scope: 'notes' },
  { id: 'close-note', name: '关闭当前标签', default: 'Ctrl+W', scope: 'notes' },
  { id: 'reopen-note', name: '重开刚关闭的标签', default: 'Ctrl+Shift+T', scope: 'notes' },
  { id: 'next-note', name: '下一个标签', default: 'Ctrl+Tab', scope: 'notes' },
  { id: 'previous-note', name: '上一个标签', default: 'Ctrl+Shift+Tab', scope: 'notes' },
  { id: 'rename-note', name: '编辑便签标题', default: 'F2', scope: 'notes' },
  { id: 'save-notes', name: '立即保存便签草稿', default: 'Ctrl+S', scope: 'notes' },
  {
    id: 'notes-zoom-in',
    name: '放大便签正文',
    default: 'Ctrl+=',
    aliases: ['Ctrl++', 'Ctrl+Shift++'],
    scope: 'notes',
  },
  { id: 'notes-zoom-out', name: '缩小便签正文', default: 'Ctrl+-', scope: 'notes' },
  { id: 'notes-zoom-reset', name: '恢复便签正文缩放', default: 'Ctrl+0', scope: 'notes' },
]);
