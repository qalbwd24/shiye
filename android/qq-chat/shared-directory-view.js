/** Explicit shared-mode list only. Never projects canonical IDs into the retained TL worker. */
export function installSharedDirectoryView({
  runtime,
  mount,
  onOpen,
  onCreate,
  onSettings,
  onError = () => {},
}) {
  if (!runtime?.directory || !mount) throw new Error('SHARED_DIRECTORY_MOUNT_REQUIRED');
  const root = document.createElement('section');
  root.className = 'shiye-shared-directory';
  root.setAttribute('aria-label', '共享随想会话');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '8',
    overflow: 'auto',
    background: 'var(--color-background, Canvas)',
    color: 'var(--color-text, CanvasText)',
  });
  const retained = new Map();
  function hideRetained() {
    for (const child of mount.children)
      if (child !== root && !retained.has(child)) {
        retained.set(child, { visibility: child.style.visibility, inert: child.inert });
        child.style.visibility = 'hidden';
        child.inert = true;
      }
  }
  hideRetained();
  mount.append(root);
  const observer = new MutationObserver(hideRetained);
  observer.observe(mount, { childList: true });
  const header = document.createElement('header');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
  });
  const title = document.createElement('strong');
  title.textContent = '共享随想';
  title.style.flex = '1';
  header.append(title);
  const button = (text, action) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'Button';
    node.textContent = text;
    node.onclick = () => Promise.resolve().then(action).catch(onError);
    return node;
  };
  let archived = false,
    disposed = false,
    version = 0;
  const toggle = button('查看归档', () => {
    archived = !archived;
    toggle.textContent = archived ? '返回会话' : '查看归档';
    return refresh();
  });
  header.append(toggle, button('新建', onCreate));
  root.append(header);
  const list = document.createElement('div');
  list.className = 'chat-list';
  root.append(list);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  root.append(status);
  async function refresh() {
    const token = ++version;
    const { rooms } = await runtime.directory.list({ includeArchived: true });
    if (disposed || token !== version) return;
    list.replaceChildren();
    for (const room of rooms.filter((value) => (archived ? value.archived : !value.archived))) {
      const row = document.createElement('div');
      row.className = 'ListItem';
      row.dataset.conversationId = room.id;
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        padding: '8px',
        gap: '8px',
      });
      const open = button(
        `${room.title || '随想'}${room.pinned ? ' · 置顶' : ''}${room.archived ? ' · 已归档' : ''}`,
        () => onOpen(room.id),
      );
      open.style.flex = '1';
      open.style.textAlign = 'left';
      row.append(
        open,
        button('设置', () => onSettings(room.id)),
      );
      list.append(row);
    }
    status.textContent = list.children.length
      ? ''
      : archived
        ? '暂无归档会话'
        : '暂无共享会话，可新建或同步后查看';
  }
  const unsubscribe = runtime.subscribe(() => {
    void refresh().catch(onError);
  });
  void refresh().catch(onError);
  return {
    refresh,
    destroy() {
      disposed = true;
      version++;
      unsubscribe();
      observer.disconnect();
      root.remove();
      for (const [child, previous] of retained) {
        child.style.visibility = previous.visibility;
        child.inert = previous.inert;
      }
    },
  };
}
