/** Comparison workspace; all decisions are revision-checked by the backend. */
export function createConflicts(c) {
  const { $, escape: esc, sanitize, api, toast } = c;
  let selected = null,
    showResolved = false,
    busy = false;
  async function manage() {
    await c.flush();
    await c.refreshLibrary();
    await c.changeView('conflicts');
  }
  function render(view, root) {
    if (view !== 'conflicts') return false;
    const conflicts = (c.library.conflicts || []).filter(
      (item) => showResolved || item.status === 'open',
    );
    if (!conflicts.some((item) => item.id === selected)) selected = conflicts[0]?.id || null;
    root.innerHTML = `<section class="conflict-workspace"><h2>重复与冲突管理</h2><p>同名或相同标识不代表相同内容。这里保留两份供你决定；完全相同的附件按 SHA-256 复用。</p><label><input id="conflictResolved" type="checkbox" ${showResolved ? 'checked' : ''}>显示已处理记录</label><div class="conflict-list">${
      conflicts
        .map((item, i) => {
          const list = item.kind === 'entry' ? c.library.entries : c.library.media;
          const right = list.find((e) => e.id === item.right);
          return `<button class="secondary" data-conflict="${item.id}">${i + 1}. ${esc(item.kind === 'entry' ? right?.title || '无标题日记' : right?.name || '附件')} · ${item.status === 'open' ? '待核对' : '已处理'}</button>`;
        })
        .join('') || '<p>没有待处理的冲突。</p>'
    }</div><div id="conflictDetail"></div></section>`;
    $('#conflictResolved').onchange = () => {
      showResolved = $('#conflictResolved').checked;
      render(view, root);
    };
    root.querySelectorAll('[data-conflict]').forEach((button) => {
      button.onclick = () => {
        selected = button.dataset.conflict;
        render(view, root);
      };
    });
    const conflict = conflicts.find((item) => item.id === selected);
    if (!conflict) return true;
    const list = conflict.kind === 'entry' ? c.library.entries : c.library.media;
    const left = list.find((item) => item.id === conflict.left),
      right = list.find((item) => item.id === conflict.right);
    if (!left || !right) {
      $('#conflictDetail').textContent = '关联内容暂不可用；记录仍保留。';
      return true;
    }
    const mediaCard = (m) => {
      const url = '/media/' + encodeURIComponent(m.id);
      return `<h3>${esc(m.name)}</h3><p>${m.size} 字节 · ${esc(m.type)}</p>${m.type.startsWith('image/') ? `<img class="conflict-image" src="${url}" alt="${esc(m.name)}">` : m.type.startsWith('video/') ? `<video class="conflict-image" src="${url}" controls preload="metadata"></video>` : m.type.startsWith('audio/') ? `<audio src="${url}" controls preload="metadata"></audio>` : ''}<p class="conflict-hash">SHA-256：${esc(m.sha256 || '旧文件未登记哈希')}</p><a href="${url}" download>下载这份附件</a>`;
    };
    const entryCard = (e) =>
      `<h3>${esc(e.title || '无标题日记')}</h3><p>${esc(e.date)} · ${esc(e.category)} · ${esc(e.tags.join('、'))}</p><p>心情：${esc(e.mood || '未填写')} · 天气：${esc(e.weather || '未填写')} · 地点：${esc(e.location || '未填写')}</p><div class="conflict-body">${sanitize(e.content)}</div><p>${e.attachments.length} 个附件 · ${e.deleted ? '回收站' : '工作库'}</p><button class="secondary" data-open-entry="${e.id}">打开查看附件与详情</button>`;
    $('#conflictDetail').innerHTML =
      `<p>${conflict.reason === 'same-identifier' ? '原日记标识相同，但内容或属性存在差异。' : '名称相同，请核对是否需要保留两份。'}</p><div class="conflict-columns"><article><small>已有版本</small>${conflict.kind === 'entry' ? entryCard(left) : mediaCard(left)}</article><article><small>导入版本</small>${conflict.kind === 'entry' ? entryCard(right) : mediaCard(right)}</article></div>${conflict.status === 'open' ? `<div class="conflict-actions"><label>导入版本的新名称（可选）<input class="field" id="conflictTitle" maxlength="500" placeholder="留空则保留原标题或文件名"></label><p>${conflict.kind === 'entry' ? '选择一份后，另一份进入回收站，可恢复。' : '选择一份后，当前日记引用切换到选中附件；原文件及编辑历史仍保留。'}保留两份可同时改名。</p><button class="primary" data-resolve="both">保留两份</button><button class="secondary" data-resolve="left">采用已有版本</button><button class="secondary" data-resolve="right">采用导入版本</button></div>` : `<p>已处理：${esc({ both: '保留两份', left: '采用已有版本', right: '采用导入版本' }[conflict.choice] || conflict.choice)}</p>`}`;
    root.querySelectorAll('[data-resolve]').forEach((button) => {
      button.onclick = async () => {
        if (busy) return;
        const title = $('#conflictTitle').value.trim(),
          choice = button.dataset.resolve;
        busy = true;
        $('#conflictDetail').inert = true;
        try {
          await c.withLibraryMutation(async () => {
            await api('/api/conflicts/' + conflict.id, {
              method: 'PUT',
              data: {
                choice,
                ...(title ? { title } : {}),
                leftRevision: left.revision,
                rightRevision: right.revision,
              },
            });
            await c.refreshLibrary();
          });
          c.renderView();
          toast('已保存处理结果');
        } catch (e) {
          toast(e.message);
        } finally {
          busy = false;
          if ($('#conflictDetail')) $('#conflictDetail').inert = false;
        }
      };
    });
    return true;
  }
  return { render, manage };
}
