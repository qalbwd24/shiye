/** Compare explicitly; filename matches never imply a library-wide replacement. */
export function createConflicts(c) {
  const { $, escape: esc, sanitize, api, toast, modal, closeModal } = c;
  let selected = null,
    showResolved = false,
    busy = false;
  const time = (value) =>
    value !== undefined && value !== null && Number.isFinite(new Date(value).getTime())
      ? new Date(value).toLocaleString('zh-CN')
      : '未记录';
  const labels = { both: '保留两份', left: '采用已有版本', right: '采用导入版本' };
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
    root.innerHTML = `<section class="conflict-workspace"><h2>重复与冲突管理</h2><p>同名附件可正常共存；相同 SHA-256、大小和类型的附件复用原文件。相同日记标识但内容不同的版本在这里核对，时间仅供参考。</p><label><input id="conflictResolved" type="checkbox" ${showResolved ? 'checked' : ''}>显示已处理记录</label><div class="conflict-list">${
      conflicts
        .map((item, i) => {
          const list = item.kind === 'entry' ? c.library.entries : c.library.media;
          const right = list.find((e) => e.id === item.right);
          return `<button class="secondary" data-conflict="${esc(item.id)}">${i + 1}. ${esc(item.kind === 'entry' ? right?.title || '无标题日记' : right?.name || '附件')} · ${item.status === 'open' ? '待核对' : '已处理'}</button>`;
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
    const isEntry = conflict.kind === 'entry';
    const list = isEntry ? c.library.entries : c.library.media;
    const left = list.find((item) => item.id === conflict.left),
      right = list.find((item) => item.id === conflict.right);
    if (!left || !right) {
      $('#conflictDetail').textContent = '关联内容暂不可用；记录仍保留。';
      return true;
    }
    const mediaCard = (m) => {
      const url = '/media/' + encodeURIComponent(m.id);
      return `<h3>${esc(m.name)}</h3><p>${m.size} 字节 · ${esc(m.type)}</p><p>文件修改时间：${esc(time(m.lastModified))}<br>首次导入时间：${esc(time(m.importedAt))}</p>${m.type.startsWith('image/') ? `<img class="conflict-image" src="${url}" alt="${esc(m.name)}">` : m.type.startsWith('video/') ? `<video class="conflict-image" src="${url}" controls preload="metadata"></video>` : m.type.startsWith('audio/') ? `<audio src="${url}" controls preload="metadata"></audio>` : ''}<p class="conflict-hash">SHA-256：${esc(m.sha256 || '旧文件未登记哈希')}</p><a href="${url}" download="${esc(m.name)}">下载原始附件</a>`;
    };
    const entryCard = (e) =>
      `<h3>${esc(e.title || '无标题日记')}</h3><p>${esc(e.date)} · ${esc(e.category)} · ${esc((e.tags || []).join('、'))}</p><p>创建：${esc(time(e.createdAt))}<br>修改：${esc(time(e.updatedAt))}</p><p>心情：${esc(e.mood || '未填写')} · 天气：${esc(e.weather || '未填写')} · 地点：${esc(e.location || '未填写')}</p><div class="conflict-body">${sanitize(e.content)}</div><p>${(e.attachments || []).length} 个附件 · ${e.deleted ? '回收站' : '工作库'}</p><button class="secondary" data-conflict-entry="${esc(e.id)}">打开日记与编辑历史</button>`;
    const comparison = `<div class="conflict-columns"><article><small>已有版本</small>${isEntry ? entryCard(left) : mediaCard(left)}</article><article><small>导入版本</small>${isEntry ? entryCard(right) : mediaCard(right)}</article></div>`;
    const action = conflict.actions?.at(-1);
    const affectedIds = action?.targets?.map((t) => t.id);
    const related = c.library.entries.filter((e) =>
      affectedIds
        ? affectedIds.includes(e.id)
        : !isEntry &&
          [e, ...(e.history || [])].some((h) =>
            (h.attachments || []).some((id) => id === left.id || id === right.id),
          ),
    );
    const history =
      conflict.status === 'resolved'
        ? `<p>已处理：${esc(labels[conflict.choice] || conflict.choice)} · ${esc(time(conflict.resolvedAt))}</p><p>${affectedIds ? `本次影响 ${affectedIds.length} 篇日记。` : '旧记录未登记具体替换范围；以下关联日记可打开编辑历史核对。'}</p>${related.map((e) => `<button class="secondary" data-conflict-entry="${esc(e.id)}">${esc(e.title || '无标题日记')} · 编辑历史</button>`).join('')}${!isEntry && action?.targets?.length && !action.undoneAt ? '<button class="secondary" id="undoConflict">撤销这次附件替换</button><p>仅在日记尚无后续编辑且历史仍存在时撤销。</p>' : ''}`
        : '';
    $('#conflictDetail').innerHTML =
      `<p>${conflict.reason === 'same-identifier' ? '原日记标识相同，但内容或属性存在差异。' : '这是旧版留下的同名提示。同名不能证明内容相同，通常直接保留两份。'}</p>${comparison}${conflict.status === 'open' ? `<div class="conflict-actions"><button class="primary" data-resolve="both">保留两份</button><button class="secondary" data-resolve="left">采用已有版本…</button><button class="secondary" data-resolve="right">采用导入版本…</button></div>` : history}`;
    const wireOpen = (scope) =>
      scope.querySelectorAll('[data-conflict-entry]').forEach((button) => {
        button.onclick = async () => {
          closeModal();
          await c.changeView('all');
          await c.selectEntry(button.dataset.conflictEntry);
        };
      });
    wireOpen(root);
    async function submit(data) {
      if (busy) return;
      busy = true;
      const confirm = $('#confirmConflict');
      if (confirm) confirm.disabled = true;
      try {
        await c.withLibraryMutation(async () => {
          await api('/api/conflicts/' + conflict.id, { method: 'PUT', data });
          await c.refreshLibrary();
        });
        closeModal();
        c.renderView();
        toast(data.choice === 'undo' ? '已撤销附件替换' : '已保存处理结果');
      } catch (e) {
        toast(e.message);
      } finally {
        busy = false;
        if (confirm?.isConnected) confirm.disabled = false;
      }
    }
    root.querySelectorAll('[data-resolve]').forEach((button) => {
      button.onclick = () => {
        const choice = button.dataset.resolve;
        const keep = choice === 'left' ? left : right,
          discard = choice === 'left' ? right : left;
        const candidates =
          !isEntry && choice !== 'both'
            ? c.library.entries.filter((e) => (e.attachments || []).includes(discard.id))
            : [];
        modal(
          '核对并' + labels[choice],
          `<div class="conflict-confirm">${comparison}<p>${choice === 'both' ? '两份内容和所有日记附件保持完整，可给导入版本改名。' : isEntry ? '另一份日记将进入回收站，可恢复。' : '仅替换你勾选的日记；原文件和替换前历史保留。已同时包含两份附件的日记不能合并。'}</p>${choice === 'both' ? '<label>导入版本的新名称（可选）<input class="field" id="conflictTitle" maxlength="500"></label>' : ''}${candidates.map((e) => `<label class="option-button"><input type="checkbox" data-conflict-target="${esc(e.id)}" ${(e.attachments || []).includes(keep.id) ? 'disabled' : ''}>${esc(e.title || '无标题日记')} · ${esc(e.date)} ${(e.attachments || []).includes(keep.id) ? '（已含两份，请保留）' : ''}</label>`).join('')}${!isEntry && choice !== 'both' && !candidates.length ? '<p>没有可替换的日记引用，请保留两份。</p>' : ''}<div class="modal-actions"><button class="primary" id="confirmConflict">确认${labels[choice]}</button></div></div>`,
        );
        wireOpen($('#modalBody'));
        $('#confirmConflict').onclick = () => {
          const targets = [
            ...$('#modalBody').querySelectorAll('[data-conflict-target]:checked'),
          ].map((box) => {
            const e = candidates.find((entry) => entry.id === box.dataset.conflictTarget);
            return { id: e.id, revision: e.revision };
          });
          if (!isEntry && choice !== 'both' && !targets.length)
            return toast('请先勾选要替换的日记，或保留两份');
          const title = $('#conflictTitle')?.value.trim();
          return submit({
            choice,
            targets,
            leftRevision: left.revision,
            rightRevision: right.revision,
            ...(title ? { title } : {}),
          });
        };
      };
    });
    if ($('#undoConflict'))
      $('#undoConflict').onclick = () => {
        modal(
          '撤销附件替换',
          '<p>将恢复这次操作前的附件关联及内嵌图片引用。若日记已被继续编辑，操作会停止，请使用编辑历史核对。</p><button class="primary" id="confirmConflict">确认撤销</button>',
        );
        $('#confirmConflict').onclick = () =>
          submit({
            choice: 'undo',
            targets: action.targets.map((t) => ({
              id: t.id,
              revision: c.library.entries.find((e) => e.id === t.id)?.revision,
            })),
          });
      };
    return true;
  }
  return { render, manage };
}
