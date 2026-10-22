/** Desktop WebDAV bridge for the Android DiarySource format. */
export function createCloudSync(c) {
  const { $, api, modal, toast, escape } = c;
  const stored = () => c.library.settings?.sync || {};
  const defaultUrl = 'https://170.106.108.102/diary-dav/';

  function setStatus(message, error = false) {
    const node = $('#syncMessage');
    if (node) {
      node.textContent = message;
      node.classList.toggle('error', error);
    }
  }

  function bytes(value) {
    const size = Number(value || 0);
    if (!size) return '0 B';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MiB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  }

  async function run(action) {
    const url = $('#syncUrl').value.trim();
    const username = $('#syncUsername').value.trim() || 'shiye';
    const password = $('#syncPassword').value;
    if (!url || !username || !password) {
      setStatus('请填写服务器地址、用户名和密码', true);
      return;
    }
    if (action === 'sync' && !$('#syncAllowUnencrypted')?.checked) {
      setStatus('原版兼容同步文件不是端到端加密；确认了解后才能上传。', true);
      return;
    }
    const button = $(
      '#' + (action === 'test' ? 'syncTest' : action === 'pull' ? 'syncPull' : 'syncNow'),
    );
    if (button) button.disabled = true;
    setStatus(action === 'test' ? '正在检查 WebDAV…' : '正在读取云端并合并，请不要关闭窗口…');
    try {
      const result = await api('/api/sync', {
        method: 'POST',
        data: {
          action,
          url,
          username,
          password,
          allowUnencrypted: $('#syncAllowUnencrypted')?.checked === true,
        },
      });
      if (action === 'test') {
        setStatus(
          result.empty
            ? '连接成功：云端 diary.json 还是空的。'
            : `连接成功：云端已有 ${result.remoteEntries} 篇日记、${result.remoteMedia} 个媒体文件。`,
        );
        return;
      }
      if (result.status === 'conflicts') {
        setStatus(result.message || '发现冲突，已停止上传。请先处理冲突。', true);
        toast('云同步暂停：请先处理冲突');
        return;
      }
      c.library.settings.sync = {
        ...(c.library.settings.sync || {}),
        url,
        username,
        lastSyncAt: new Date().toISOString(),
      };
      await c.refreshLibrary();
      const pulled = result.pulled || {};
      const pushed = result.pushed || {};
      setStatus(
        `同步完成：合并 ${pulled.entries || 0} 篇、${pulled.media || 0} 个媒体；上传 ${pushed.uploadedMedia || 0} 个媒体（${bytes(pushed.uploadedMediaBytes)}），${pushed.skipped ? '本次日记文件未重复上传。' : `日记文件 ${bytes(pushed.bytes)}。`}`,
      );
      toast('云同步完成');
    } catch (error) {
      setStatus(error.message, true);
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function settings() {
    let status = stored();
    try {
      status = await api('/api/sync/status');
    } catch {
      /* Older running builds simply use the defaults. */
    }
    const defaultUsername = status.username || 'shiye';
    modal(
      '同步到自己的服务器',
      `<p>电脑端会先读取云端的安卓兼容数据，再和本地库合并；发现同一标识的不同版本时会停止上传，等你在冲突管理中选择。密码只用于本次同步，不写进日记库。</p><p class="sync-warning">兼容原版手机的 <code>diary.json</code> 是普通 WebDAV 文件，HTTPS 只保护传输，不能让服务器看不到正文。若你需要端到端加密，请先不要上传真实日记，后续单独设计加密容器。</p><label>WebDAV 地址<input class="field" id="syncUrl" value="${escape(status.url || defaultUrl)}" placeholder="https://你的域名/diary-dav/"></label><label>用户名<input class="field" id="syncUsername" value="${escape(defaultUsername)}" placeholder="默认：shiye" autocomplete="off"></label><label>密码<input class="field" id="syncPassword" type="password" autocomplete="off"></label><label class="check-row"><input id="syncAllowUnencrypted" type="checkbox">我已了解兼容格式不是端到端加密，允许本次上传</label><div class="modal-actions"><button class="secondary" id="syncTest">测试连接</button><button class="secondary" id="syncPull">只从云端合并</button><button class="primary" id="syncNow">合并并同步</button></div><p id="syncMessage" role="status">${status.lastSyncAt ? `上次同步：${escape(status.lastSyncAt)}` : '云端为空时会把当前电脑库作为第一份数据上传。'}</p>`,
    );
    // Some WebView builds normalize an empty value attribute while creating
    // the modal. Restore the documented default as a property as well.
    const usernameInput = document.getElementById('syncUsername');
    if (usernameInput && !usernameInput.value) {
      usernameInput.value = defaultUsername;
      usernameInput.setAttribute('value', defaultUsername);
    }
    $('#syncTest').onclick = () => run('test');
    $('#syncPull').onclick = () => run('pull');
    $('#syncNow').onclick = () => run('sync');
    $('#syncPassword').focus();
  }

  return { settings };
}
