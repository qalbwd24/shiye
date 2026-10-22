import { sortedTaxonomy } from '../shared/taxonomy.js';
import { applyTheme } from './theme.js';
import { setTimeZone, DEFAULT_TIME_ZONE, zonedDay, formatZoned } from '../shared/time-zone.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createPreferences(c) {
  const { $, api, modal, closeModal, toast } = c;
  let idleTimer = null,
    lastReminder = '';
  const prefs = () => c.library.settings?.preferences || {};
  async function preference(data) {
    await api('/api/preferences', { method: 'PUT', data });
    c.library.settings.preferences = { ...prefs(), ...data };
    apply();
  }
  function apply() {
    const p = prefs();
    setTimeZone(p.timeZone || DEFAULT_TIME_ZONE);
    applyTheme(p);
    document.documentElement.style.setProperty('--writing-size', (p.fontSize || 16) + 'px');
    document.documentElement.style.setProperty('--writing-line', p.lineHeight || 2);
    document.documentElement.style.setProperty(
      '--writing-font',
      p.fontFamily === 'serif'
        ? 'Georgia, SimSun, serif'
        : p.fontFamily === 'mono'
          ? 'Consolas, monospace'
          : '"Microsoft YaHei", sans-serif',
    );
    resetIdle();
  }
  async function lock() {
    await c.flush();
    await api('/api/lock', { method: 'POST', data: {} });
    location.reload();
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    if (prefs().autoLockMinutes)
      idleTimer = setTimeout(
        () => lock().catch((e) => toast(e.message)),
        prefs().autoLockMinutes * 60000,
      );
  }
  async function settings() {
    const access = await api('/api/access');
    modal(
      '本地功能设置',
      `<label>主题<select class="field" id="prefTheme">${['light', 'dark', 'system'].map((v, i) => `<option value="${v}">${['浅色', '深色', '跟随系统'][i]}</option>`).join('')}</select></label><label>正文字号<select class="field" id="prefSize">${[14, 16, 18, 20, 22, 24].map((v) => `<option>${v}</option>`).join('')}</select></label><label>行距<select class="field" id="prefLine">${[1.6, 1.8, 2, 2.2, 2.5].map((v) => `<option>${v}</option>`).join('')}</select></label><label>字体<select class="field" id="prefFont"><option value="sans">无衬线</option><option value="serif">衬线</option><option value="mono">等宽</option></select></label><label>排序<select class="field" id="prefSort"><option value="newest">记录日期：新到旧</option><option value="oldest">记录日期：旧到新</option><option value="updated">最近修改</option></select></label><label class="check-row"><input id="prefPreview" type="checkbox">列表显示正文摘要</label><label class="check-row"><input id="prefYesterday" type="checkbox">凌晨 0–4 点新建日记时默认记作昨天</label><label class="check-row"><input id="prefIndent" type="checkbox">正文开头与普通换段自动空两格</label><label>打开应用时<select class="field" id="prefOpen"><option value="all">日记列表</option><option value="calendar">日历</option><option value="new">新建日记</option></select></label><label>每周第一天<select class="field" id="prefWeek"><option value="1">星期一</option><option value="0">星期日</option></select></label><label>提醒语<input class="field" id="prefReminderText"></label><label>写作提醒（应用打开时）<input class="field" type="time" id="prefReminder"></label><label>自动锁定<select class="field" id="prefLock"><option value="0">不自动锁定</option><option value="1">1 分钟</option><option value="5">5 分钟</option><option value="15">15 分钟</option></select></label><button class="primary" id="savePrefs">保存设置</button><button class="secondary" id="setupLock">${access.enabled ? '修改／关闭本地锁' : '设置本地锁'}</button><p>本地锁保护此应用和本地接口的访问，不等于磁盘加密。备份密码与本地锁密码是两回事。</p>`,
    );
    const p = prefs();
    const zoneLabel = document.createElement('label');
    zoneLabel.textContent = '日期与时间的时区';
    const zoneSelect = document.createElement('select');
    zoneSelect.className = 'field';
    zoneSelect.id = 'prefTimeZone';
    for (const [value, label] of [
      ['Asia/Shanghai', '北京时间（UTC+08:00）'],
      ['system', '跟随系统'],
      ['UTC', '协调世界时（UTC）'],
      ['Asia/Tokyo', '东京'],
      ['America/Los_Angeles', '美国太平洋时间'],
      ['America/New_York', '美国东部时间'],
      ['Europe/London', '伦敦'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      zoneSelect.append(option);
    }
    const selectedZone = p.timeZone || DEFAULT_TIME_ZONE;
    if (![...zoneSelect.options].some((option) => option.value === selectedZone)) {
      const option = document.createElement('option');
      option.value = selectedZone;
      option.textContent = selectedZone;
      zoneSelect.append(option);
    }
    zoneSelect.value = selectedZone;
    zoneLabel.append(zoneSelect);
    $('#prefSort').closest('label').before(zoneLabel);
    const categoryLabel = document.createElement('label');
    const focusLabel = document.createElement('label');
    focusLabel.textContent = '思绪进入编辑时';
    const focusSelect = document.createElement('select');
    focusSelect.className = 'field';
    focusSelect.id = 'prefQuickFocus';
    focusSelect.innerHTML =
      '<option value="body">先写正文</option><option value="title">先写标题</option>';
    focusSelect.value = p.quickInitialFocus || 'body';
    focusLabel.append(focusSelect);
    $('#prefIndent').closest('label').after(focusLabel);
    categoryLabel.textContent = '新日记默认分类';
    const categorySelect = document.createElement('select');
    categorySelect.className = 'field';
    categorySelect.id = 'prefDefaultCategory';
    const unset = document.createElement('option');
    unset.value = '';
    unset.textContent = '尚未设置（预选排序第一项）';
    unset.disabled = true;
    categorySelect.append(unset);
    for (const item of sortedTaxonomy(c.library, 'category')) {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      categorySelect.append(option);
    }
    categorySelect.value = p.defaultCategory || '';
    categoryLabel.append(categorySelect);
    $('#prefOpen').closest('label').before(categoryLabel);
    for (const [id, value] of [
      ['prefTheme', p.theme || 'system'],
      ['prefSize', p.fontSize || 16],
      ['prefLine', p.lineHeight || 2],
      ['prefFont', p.fontFamily || 'sans'],
      ['prefSort', p.sort || 'newest'],
      ['prefReminder', p.reminderTime || ''],
      ['prefLock', p.autoLockMinutes || 0],
      ['prefOpen', p.openView || 'all'],
      ['prefWeek', p.firstWeekday ?? 1],
      ['prefReminderText', p.reminderText || ''],
    ])
      $('#' + id).value = value;
    $('#prefPreview').checked = p.showPreview !== false;
    $('#prefYesterday').checked = !!p.nightYesterday;
    $('#prefIndent').checked = p.autoIndentParagraph !== false;
    $('#savePrefs').onclick = async () => {
      try {
        await preference({
          ...(categorySelect.value ? { defaultCategory: categorySelect.value } : {}),
          quickInitialFocus: focusSelect.value,
          timeZone: zoneSelect.value,
          theme: $('#prefTheme').value,
          fontSize: Number($('#prefSize').value),
          lineHeight: Number($('#prefLine').value),
          fontFamily: $('#prefFont').value,
          sort: $('#prefSort').value,
          showPreview: $('#prefPreview').checked,
          nightYesterday: $('#prefYesterday').checked,
          autoIndentParagraph: $('#prefIndent').checked,
          reminderTime: $('#prefReminder').value,
          autoLockMinutes: Number($('#prefLock').value),
          openView: $('#prefOpen').value,
          firstWeekday: Number($('#prefWeek').value),
          reminderText: $('#prefReminderText').value,
        });
        closeModal();
        c.renderView();
        toast('设置已保存');
      } catch (e) {
        toast(e.message);
      }
    };
    $('#setupLock').onclick = () => {
      modal(
        '本地锁',
        `${access.enabled ? '<label>当前密码<input class="field" type="password" id="oldLockPassword" autocomplete="current-password"></label>' : ''}<label>新密码<input class="field" type="password" id="newLockPassword" placeholder="至少 8 个字符" autocomplete="new-password"></label><label>再输入一次<input class="field" type="password" id="confirmLockPassword" autocomplete="new-password"></label><button class="primary" id="saveLockPassword">保存本地锁</button>${access.enabled ? '<button class="secondary" id="disableLockPassword">关闭本地锁</button>' : ''}<p id="lockMessage" role="status"></p>`,
      );
      const save = async (disable) => {
        try {
          if (!disable && $('#newLockPassword').value !== $('#confirmLockPassword').value)
            throw Error('两次密码不一致');
          await api('/api/access', {
            method: 'PUT',
            data: {
              oldPassword: $('#oldLockPassword')?.value,
              password: $('#newLockPassword').value,
              disable,
            },
          });
          closeModal();
          toast(disable ? '本地锁已关闭' : '本地锁已设置');
        } catch (e) {
          $('#lockMessage').textContent = e.message;
        }
      };
      $('#saveLockPassword').onclick = () => save(false);
      if ($('#disableLockPassword')) $('#disableLockPassword').onclick = () => save(true);
    };
  }
  for (const event of ['pointerdown', 'keydown'])
    document.addEventListener(event, resetIdle, { passive: true });
  setInterval(() => {
    const time = formatZoned(new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      key = zonedDay(new Date()) + ' ' + time;
    if (prefs().reminderTime === time && lastReminder !== key) {
      lastReminder = key;
      toast(prefs().reminderText || '到了写日记的时间，给今天留下一页吧。');
    }
  }, 15000);
  return { apply, preference, prefs, settings, lock };
}
