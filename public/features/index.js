import { createAlbum } from './album.js';
import { createRecollection } from './recollection.js';
import { createEntryReader } from './entry-reader.js';
import { createEditorInput } from './editor-input.js';
import { createConflicts } from './conflicts.js';
import { createPreferences } from './preferences.js';
import { createAppearance } from './appearance.js';
import { createLayout } from './layout.js';
import { createWorkbench } from './workbench.js';
import { createGallery } from './gallery.js';
import { createComments } from './comments.js';
import { createStickers } from './stickers.js';
import { createContextMenu } from './context-menu.js';
import { createReadingPosition } from './reading-position.js';
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
  const reader = createEntryReader(c);
  const editorInput = createEditorInput(c);
  const browsingContext = Object.create(c);
  browsingContext.releaseEntryReader = reader.release;
  browsingContext.mountEntryReader = reader.mount;
  const { apply: applyPreferences, preference, prefs, settings, lock } = createPreferences(c);
  const appearance = createAppearance(c);
  const layout = createLayout(c);
  const readingGallery = createGallery(c, {
    defer: () => $('#editorPanel').classList.contains('inline-editing'),
  });
  const attachmentGallery = createGallery(c, { host: $('#attachmentEditor'), editing: () => true });
  const gallery = {
    render(entry) {
      readingGallery.render(entry);
      attachmentGallery.render(entry);
    },
  };
  const album = createAlbum(browsingContext);
  const recollection = createRecollection(browsingContext);
  const readingPosition = createReadingPosition(c);
  const stickers = createStickers(c);
  const commentContext = Object.create(c);
  commentContext.stickers = stickers;
  const comments = createComments(commentContext);
  const apply = () => {
    applyPreferences();
    appearance.apply();
    layout.apply();
    workbench.applyProfile();
  };
  const { advancedSearch, filter } = createSearch(c);
  const { render: renderInsights } = createInsights(c, { prefs, preference });
  const { manage, render: renderOrganization } = createOrganization(c);
  const conflicts = createConflicts(c);
  const render = (view, root) =>
    album.render(view, root) ||
    recollection.render(view, root) ||
    conflicts.render(view, root) ||
    renderOrganization(view, root) ||
    renderInsights(view, root);
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
  const workbench = createWorkbench(c, {
    beginEditing: () => gallery.render(c.current()),
    completeEditing: () => gallery.render(c.current()),
    preferences: settings,
    appearance: appearance.settings,
    layout,
    manage,
    conflicts: conflicts.manage,
    backups: backupsV2,
    exportMenu,
    lock,
    stickers: stickers.manage,
  });
  button('筛选', advancedSearch, $('.search-controls')).id = 'filterButton';
  const moreViews = document.createElement('details');
  moreViews.className = 'more-views';
  moreViews.innerHTML = '<summary>更多视图</summary>';
  try {
    moreViews.open = localStorage.getItem('shiye.more-views') === 'true';
  } catch {
    /* Optional storage. */
  }
  moreViews.addEventListener('toggle', () => {
    try {
      localStorage.setItem('shiye.more-views', String(moreViews.open));
    } catch {
      /* Optional storage. */
    }
  });
  $('#navigation').append(moreViews);
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
    moreViews.append(b);
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
  $('#attachmentEditor').addEventListener('dblclick', (e) => {
    const img = e.target.closest('img');
    if (img) {
      const id = img.getAttribute('src').split('/').pop();
      draw(id);
    }
  });
  const imageNote = document.createElement('small');
  imageNote.className = 'gallery-edit-hint';
  imageNote.textContent = '双击图片可旋转或裁剪副本';
  $('#attachmentEditor').after(imageNote);
  return {
    captureNavigation: () => ({
      album: album.captureNavigation(),
      recollection: recollection.captureNavigation(),
    }),
    restoreNavigation(snapshot) {
      album.restoreNavigation(snapshot?.album);
      recollection.restoreNavigation(snapshot?.recollection);
    },
    editorInput,
    render,
    releaseEntryReader: reader.release,
    gallery,
    readingPosition,
    showList: layout.showList,
    comments,
    stickers,
    filter,
    apply,
    preference,
    prefs,
    templates,
    backups: backupsV2,
    settings: workbench.settings,
    toggleWriting: workbench.toggleWriting,
    readingMode: workbench.readingMode,
    lock,
  };
}
