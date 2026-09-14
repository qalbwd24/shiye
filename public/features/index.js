import { createConflicts } from './conflicts.js';
import { createPreferences } from './preferences.js';
import { createAppearance } from './appearance.js';
import { createLayout } from './layout.js';
import { createContextMenu } from './context-menu.js';
import { createSearch } from './search.js';
import { createInsights } from './insights.js';
import { createOrganization } from './organization.js';
import { createTemplates } from './templates.js';
import { createEditorTools } from './editor-tools.js';
import { createMediaTools } from './media-tools.js';
import { createExport } from './export.js';
import { createBackups } from './backups.js';
export function installOffline(c) {
  const { $, modal, closeModal, toast, command } = c;
  const { apply: applyPreferences, preference, prefs, settings, lock } = createPreferences(c);
  const appearance = createAppearance(c);
  const layout = createLayout(c);
  const apply = () => {
    applyPreferences();
    appearance.apply();
    layout.apply();
  };
  const { advancedSearch, filter } = createSearch(c);
  const { render: renderInsights } = createInsights(c, { prefs, preference });
  const { manage, render: renderOrganization } = createOrganization(c);
  const conflicts = createConflicts(c);
  const render = (view, root) =>
    conflicts.render(view, root) || renderOrganization(view, root) || renderInsights(view, root);
  const { templates } = createTemplates(c);
  const { toggle, markdown } = createEditorTools(c);
  const { recording, draw, speak } = createMediaTools(c);
  const { exportMenu } = createExport(c);
  createContextMenu(c, { exportMenu });
  const { backupsV2 } = createBackups(c);
  const button = (name, fn, parent = $('.bottom-actions')) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () =>
      Promise.resolve()
        .then(fn)
        .catch((e) => toast(e.message));
    parent.append(b);
    return b;
  };
  button('功能设置', settings);
  button('外观与背景', appearance.settings);
  button('分类管理', manage);
  button('冲突管理', conflicts.manage);
  button('完整备份', backupsV2);
  button('锁定', lock);
  button('导出', exportMenu);
  button('筛选', advancedSearch, $('.topbar-right'));
  for (const [name, view] of [
    ['往日此时', 'recall'],
    ['地点', 'places'],
    ['草稿箱', 'drafts'],
    ['隐藏日记', 'hidden'],
  ]) {
    const b = document.createElement('button');
    b.className = 'nav-button';
    b.dataset.view = view;
    b.textContent = name;
    $('#navigation').append(b);
  }
  for (const [name, fn] of [
    ['Markdown', markdown],
    ['模板库', templates],
    ['录音', recording],
    ['手绘', () => draw()],
    ['朗读', speak],
    ['隐藏', () => toggle('hidden')],
    ['草稿', () => toggle('draft')],
    ['撤销', () => command('undo')],
    ['重做', () => command('redo')],
    ['下划线', () => command('underline')],
    ['编号列表', () => command('insertOrderedList')],
    [
      '链接',
      () => {
        modal(
          '插入链接',
          '<input class="field" id="linkUrl" placeholder="https://"><button class="primary" id="insertLink">插入</button>',
        );
        $('#insertLink').onclick = () => {
          const url = $('#linkUrl').value;
          if (!/^https?:\/\//i.test(url)) return toast('请输入 http 或 https 地址');
          closeModal();
          command('createLink', url);
        };
      },
    ],
  ])
    button(name, fn, $('#formatToolbar'));
  const color = document.createElement('input');
  color.type = 'color';
  color.title = '文字颜色';
  color.oninput = () => command('foreColor', color.value);
  $('#formatToolbar').append(color);
  $('#attachments').addEventListener('dblclick', (e) => {
    const img = e.target.closest('img');
    if (img) {
      const id = img.getAttribute('src').split('/').pop();
      draw(id);
    }
  });
  const imageNote = document.createElement('small');
  imageNote.textContent = '双击图片可旋转或裁剪副本';
  $('#attachments').after(imageNote);
  return {
    render,
    filter,
    apply,
    preference,
    prefs,
    templates,
    backups: backupsV2,
    settings,
    lock,
  };
}
