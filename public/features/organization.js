/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createOrganization(c) {
  const { $, api, escape: esc, modal, closeModal, toast } = c;

  async function manage() {
    await c.flush();
    modal(
      '分类与标签管理',
      `<label>类型<select class="field" id="taxKind"><option value="category">分类</option><option value="tag">标签</option></select></label><label>选择<select class="field" id="taxFrom"></select></label><label>新名称／合并目标<input class="field" id="taxTo"></label><button class="primary" id="taxRename">重命名／合并</button><button class="secondary" id="taxRemove">移除此分类或标签</button><p>移除分类后日记归到“未分类”；移除标签不删除日记。可在单篇历史中恢复之前的内容。</p>`,
    );
    const choices = () =>
      ($('#taxFrom').innerHTML = (
        $('#taxKind').value === 'category'
          ? c.library.categories
          : [...new Set(c.library.entries.flatMap((e) => e.tags))]
      )
        .map((v) => `<option>${esc(v)}</option>`)
        .join(''));
    choices();
    $('#taxKind').onchange = choices;
    const submit = async (action) => {
      try {
        await api('/api/taxonomy', {
          method: 'POST',
          data: {
            kind: $('#taxKind').value,
            from: $('#taxFrom').value,
            to: action === 'remove' ? '' : $('#taxTo').value,
            action,
          },
        });
        await c.refreshLibrary();
        closeModal();
        c.renderView();
      } catch (e) {
        toast(e.message);
      }
    };
    $('#taxRename').onclick = () => submit('rename');
    $('#taxRemove').onclick = () => submit('remove');
  }

  return { manage };
}
