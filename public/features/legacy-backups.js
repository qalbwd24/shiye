import { encryptVault, decryptVault } from '../shared/vault.js';
export function createLegacyBackups(c) {
  const {
    modal,
    icon,
    localDate,
    download,
    flush,
    api,
    $,
    uploadLegacyFile,
    refreshLibrary,
    renderView,
    escape,
  } = c;
  function backups() {
    modal(
      '备份与旧数据导入',
      `<p>本地工作库保存在电脑。上传到你自己的云盘时，请使用加密备份；它包含日记、媒体、历史和保留的旧格式原件。</p><button class="option-button" id="encryptBackup">${icon('lock')} 创建加密备份<small>密码由你设置，浏览器本地加密，密码不保存</small></button><button class="option-button" id="restoreBackup">恢复加密备份<small>追加恢复，不覆盖当前记录</small></button><button class="option-button" id="importLegacy">导入一本日记旧备份<small>Android ZIP / Windows 加密文件 / WebDAV JSON</small></button><button class="option-button" id="downloadJson">导出明文 JSON<small>仅用于本地核对，不含附件原件，不建议直接放到云盘</small></button>${c.library.imports.length ? '<div class="archive-list"><p>保留的原始备份</p>' + c.library.imports.map((a) => `<a href="/api/original/${a.id}" download>${icon('download')} ${escape(a.name)}<small>${escape(a.kind)} · 原始字节完整保留</small></a>`).join('') + '</div>' : ''}`,
    );
    $('#encryptBackup').onclick = () => {
      modal(
        '创建加密备份',
        `<p>日记和媒体会一起加密。请记住密码：程序没有找回入口。当前整包附件与旧原件总量上限为 128 MB。</p><label class="form-label">备份密码<input class="field" id="vaultPassword" type="password" minlength="12" autocomplete="new-password" placeholder="至少 12 个字符"></label><label class="form-label">再次输入<input class="field" id="vaultConfirm" type="password" autocomplete="new-password"></label><button class="primary" id="createVault">加密并下载</button><p id="vaultMessage" role="status"></p>`,
      );
      $('#createVault').onclick = async () => {
        const p = $('#vaultPassword').value;
        if (p !== $('#vaultConfirm').value) {
          $('#vaultMessage').textContent = '两次密码不一致';
          return;
        }
        $('#createVault').disabled = true;
        try {
          await flush();
          $('#vaultMessage').textContent = '正在读取本地文件并加密…';
          const bundle = await api('/api/bundle');
          const encrypted = await encryptVault(bundle, p);
          download(
            '拾页加密备份-' + localDate(new Date()),
            'application/json',
            JSON.stringify(encrypted),
            'syvault',
          );
          $('#vaultPassword').value = '';
          $('#vaultConfirm').value = '';
          $('#vaultMessage').textContent =
            '加密备份已生成。可以把 .syvault 文件存到你的云服务器或网盘。';
        } catch (e) {
          $('#vaultMessage').textContent = e.message;
        } finally {
          $('#createVault').disabled = false;
        }
      };
    };
    $('#restoreBackup').onclick = () => {
      modal(
        '恢复加密备份',
        `<p>密码只在本机解密，恢复后追加记录，不覆盖现有内容。</p><input class="field" id="restoreFile" type="file" accept=".syvault"><input class="field" id="restorePassword" type="password" autocomplete="current-password" placeholder="备份密码"><button class="primary" id="doRestore">解密并恢复</button><p id="restoreMessage" role="status"></p>`,
      );
      $('#doRestore').onclick = async () => {
        const f = $('#restoreFile').files[0];
        if (!f) {
          $('#restoreMessage').textContent = '请选择加密备份';
          return;
        }
        $('#doRestore').disabled = true;
        try {
          await flush();
          $('#restoreMessage').textContent = '正在解密与校验…';
          const bundle = await decryptVault(
            JSON.parse(await f.text()),
            $('#restorePassword').value,
          );
          const result = await api('/api/restore', { method: 'POST', data: bundle });
          await refreshLibrary();
          renderView();
          $('#restorePassword').value = '';
          $('#restoreMessage').textContent =
            `已追加恢复 ${result.entries} 篇日记、${result.media} 个媒体文件。`;
        } catch (e) {
          $('#restoreMessage').textContent = e.message;
        } finally {
          $('#doRestore').disabled = false;
        }
      };
    };
    $('#importLegacy').onclick = () => {
      modal(
        '打开旧格式备份',
        `<p>导入副本，保留原来的加密文件和全部字段。支持大 ZIP 分批解压和 CRC 校验。Markdown 转为富文本，原始字段及加密原件保留。不会连接官方账号。</p><input class="field" id="legacyFile" type="file"><button class="primary" id="doImport">导入到本地</button><p id="importMessage" role="status"></p>`,
      );
      $('#doImport').onclick = async () => {
        const f = $('#legacyFile').files[0];
        if (!f) {
          $('#importMessage').textContent = '请选择备份文件';
          return;
        }
        $('#doImport').disabled = true;
        try {
          await flush();
          $('#importMessage').textContent = '正在解码、保存原件并核对引用…';
          const uploaded = await uploadLegacyFile(f, $('#importMessage'));
          $('#importMessage').textContent =
            '文件已接收，正在逐项解压、校验并保存，媒体较多时需要几分钟…';
          const r = await api('/api/import-upload/' + uploaded.id + '/commit', {
            method: 'POST',
            data: {},
          });
          await refreshLibrary();
          renderView();
          $('#importMessage').textContent =
            `已导入 ${r.entries} 篇日记，保留 ${r.media} 个媒体文件；${r.unresolved} 项引用未匹配。${r.formatting}`;
        } catch (e) {
          $('#importMessage').textContent = e.message;
        } finally {
          $('#doImport').disabled = false;
        }
      };
    };
    $('#downloadJson').onclick = async () => {
      await flush();
      location.assign('/api/export');
    };
  }
  return { backups };
}
