import { createBackup, restoreBackup } from '../shared/vault2.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createBackups(c) {
  const { $, api, escape: esc, modal } = c;

  async function backupsV2() {
    await c.flush();
    const saved = await api('/api/backups');
    modal(
      '完整加密备份',
      `<p>新版按文件分块加密，先压缩再加密，无旧版 128 MB 整包限制。密码仅用于本机浏览器加解密，备份会保存到项目 data/backups 文件夹。</p><button class="option-button" id="createV2">创建完整加密备份</button><button class="option-button" id="restoreV2">恢复分块加密备份</button><button class="option-button" id="legacyBackup">旧版备份与原格式导入</button><div>${saved.map((f) => `<a class="option-button" href="/api/backups/${f.id}" download>${esc(f.createdAt.slice(0, 19).replace('T', ' '))} · ${(f.size / 1048576).toFixed(2)} MB · 下载</a>`).join('')}</div>`,
    );
    $('#legacyBackup').onclick = c.legacyBackups;
    $('#createV2').onclick = () => {
      modal(
        '创建分块加密备份',
        '<label>备份密码<input id="v2Password" class="field" type="password" autocomplete="new-password" placeholder="至少 12 个字符"></label><label>重复密码<input id="v2Confirm" class="field" type="password" autocomplete="new-password"></label><button class="primary" id="runV2">加密并保存到本机</button><p id="v2Status" role="status"></p>',
      );
      $('#runV2').onclick = async () => {
        const status = $('#v2Status'),
          b = $('#runV2'),
          passwordField = $('#v2Password'),
          confirmField = $('#v2Confirm'),
          password = passwordField.value;
        if (password !== confirmField.value) {
          status.textContent = '两次密码不一致';
          return;
        }
        b.disabled = true;
        try {
          status.textContent = '正在核对文件…';
          const result = await createBackup(
            api,
            password,
            (n, total) =>
              (status.textContent = `正在加密保存 ${(n / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`),
          );
          passwordField.value = confirmField.value = '';
          status.textContent = '已写入并完成文件校验：' + result.path;
          status.insertAdjacentHTML(
            'beforeend',
            `<br><a href="/api/backups/${result.id}" download>另存一份到其他位置</a>`,
          );
        } catch (e) {
          status.textContent = '备份没有完成：' + e.message;
        } finally {
          b.disabled = false;
        }
      };
    };
    $('#restoreV2').onclick = () => {
      modal(
        '恢复分块加密备份',
        '<p>先完整校验，再追加恢复；现有日记不会被覆盖。</p><input type="file" id="v2File" class="field" accept=".syvault2"><input type="password" id="v2RestorePassword" class="field" placeholder="备份密码"><button class="primary" id="runV2Restore">校验并恢复</button><p id="v2RestoreStatus" role="status"></p>',
      );
      $('#runV2Restore').onclick = async () => {
        const f = $('#v2File').files[0],
          status = $('#v2RestoreStatus'),
          b = $('#runV2Restore'),
          passwordField = $('#v2RestorePassword');
        if (!f) {
          status.textContent = '请选择 .syvault2 文件';
          return;
        }
        b.disabled = true;
        try {
          const result = await restoreBackup(
            api,
            f,
            passwordField.value,
            (n, total) =>
              (status.textContent = `解密校验 ${(n / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`),
          );
          await c.refreshLibrary();
          c.renderView();
          passwordField.value = '';
          status.textContent = `已追加恢复 ${result.entries} 篇日记、${result.media} 个附件。`;
        } catch (e) {
          status.textContent = '没有恢复：' + e.message;
        } finally {
          b.disabled = false;
        }
      };
    };
  }

  return { backupsV2 };
}
