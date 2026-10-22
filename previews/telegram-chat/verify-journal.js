/* Loaded by --verify --verify-journal; native bridge is restricted to isolated port 18767. */
(async () => {
  const result = { kind: 'journal-verification', checks: [], errors: [] };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const expect = (ok, name) => {
    if (!ok) throw Error(name);
    result.checks.push(name);
  };
  async function until(read, name) {
    for (let i = 0; i < 150; i++) {
      if (read()) return;
      await wait(150);
    }
    throw Error(name);
  }
  const { native, key, trustedClick } = await window.shiyeVerifyInput({
    expect,
    until,
    wait,
    result,
  });
  try {
    await until(() => window.shiyeJournal && window.shiyeRoomUi, '归档与话题入口');
    const state = await window.shiyeJournal.status();
    const proof = JSON.parse(localStorage.getItem('shiye-journal-proof') || 'null');
    if (proof) {
      result.roomId = proof.roomId;
      result.imageHash = proof.imageHash;
      result.imageBytes = proof.imageBytes;
      result.marker = proof.marker;
      expect(
        state.rooms[proof.roomId]?.enabled && state.rooms[proof.roomId].category === '日常',
        '重开后归档开关与分类保留',
      );
      window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: proof.roomId } }));
      await until(() => document.querySelector('#editable-message-text'), '重开后输入框');
      await wait(700);
      if (state.lastError) {
        const input = document.querySelector('#editable-message-text');
        input.focus();
        const marker = '离线补写验收-' + Date.now();
        await native('Input.insertText', { text: marker });
        await key('Enter', 'Enter', 13);
        await until(
          () =>
            [...document.querySelectorAll('.Message')].some((n) => n.textContent.includes(marker)),
          '离线仍可发送消息',
        );
        await window.shiyeRoomUi.command('flush');
        let rejected = false;
        try {
          await window.shiyeJournal.flush();
        } catch {
          rejected = true;
        }
        expect(
          rejected && !!(await window.shiyeJournal.status()).lastError,
          '归档断线明确报错且本地消息保留',
        );
        const found = await window.shiyeRoomUi.command('search', { query: marker });
        expect(
          found.matches.some((m) => m.chatId === proof.roomId),
          '离线消息已落入本地消息库',
        );
        proof.offlineMarker = marker;
        localStorage.setItem('shiye-journal-proof', JSON.stringify(proof));
        result.offlineMarker = marker;
        result.phase = 'offline';
      } else {
        await window.shiyeJournal.flush();
        expect(!(await window.shiyeJournal.status()).lastError, '重开后自动归档补写成功');
        await window.shiyeJournal.flush();
        expect(!(await window.shiyeJournal.status()).lastError, '重开后的重复检查成功');
        if (!proof.largeImageHash) {
          localStorage.setItem('shiye-image-quality', 'original');
          let editor;
          window.dispatchEvent(
            new CustomEvent('shiye-editor-request', {
              detail: {
                receive: (value) => {
                  editor = value;
                },
              },
            }),
          );
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext('2d'),
            pixels = context.createImageData(640, 480);
          for (let offset = 0; offset < pixels.data.length; offset += 65536)
            crypto.getRandomValues(
              pixels.data.subarray(offset, Math.min(pixels.data.length, offset + 65536)),
            );
          context.putImageData(pixels, 0, 0);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          expect(blob.size > 262144, '原图超过单个传输分块');
          proof.largeImageHash = [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          ]
            .map((n) => n.toString(16).padStart(2, '0'))
            .join('');
          proof.largeImageBytes = blob.size;
          editor.files([new File([blob], '多分块原图.png', { type: 'image/png' })]);
          await until(
            () =>
              document.querySelector('[aria-label="确认发送"]') &&
              !document.querySelector('[aria-label="确认发送"]').disabled,
            '多分块图片预览',
          );
          await trustedClick(document.querySelector('[aria-label="确认发送"]'));
          await until(
            () => !document.querySelector('#editable-message-text-modal'),
            '多分块图片发送',
          );
          await wait(1000);
          await window.shiyeRoomUi.command('flush');
          await window.shiyeJournal.flush();
          expect(!(await window.shiyeJournal.status()).lastError, '多个分块完整传入拾页');
          localStorage.setItem('shiye-journal-proof', JSON.stringify(proof));
        }
        result.largeImageHash = proof.largeImageHash;
        result.largeImageBytes = proof.largeImageBytes;
        result.offlineMarker = proof.offlineMarker;
        result.phase = 'recovered';
      }
      chrome.webview.postMessage(result);
      return;
    }
    expect(state.categories.includes('日常') && !state.lastError, '读取隔离拾页现有分类');
    window.dispatchEvent(new Event('shiye-new-topic'));
    await until(() => document.querySelector('dialog[open] [name=archiveEnabled]'), '自动归档设置');
    const form = document.querySelector('dialog[open] form');
    expect(form.elements.category.tagName === 'SELECT', '分类为真实下拉选项');
    form.elements.title.value = '自动归篇验收-' + Date.now();
    const title = form.elements.title.value;
    form.elements.category.value = '日常';
    form.elements.archiveEnabled.checked = true;
    expect(form.elements.idleHours.value === '5', '归篇默认五小时');
    form.requestSubmit();
    await until(() => !form.isConnected, '配置保存成功并关闭');
    const { rooms } = await window.shiyeRoomUi.command('list');
    const room = rooms.find((r) => r.title === title);
    result.roomId = room.id;
    expect((await window.shiyeJournal.status()).rooms[room.id]?.enabled, '归档开关持久化');
    window.dispatchEvent(new CustomEvent('shiye-open-room', { detail: { id: room.id } }));
    await until(() => document.querySelector('#editable-message-text'), '编辑框就绪');
    await wait(500);
    const marker = '中文实际输入归篇-' + Date.now();
    const input = document.querySelector('#editable-message-text');
    input.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, '');
    await native('Input.insertText', {
      text: `# ${marker}\n\n*斜体* **粗体** ==高亮==\n\n- [x] 完成\n\n\`\`\`js\nconst a = 1;\n\`\`\``,
    });
    await key('Enter', 'Enter', 13);
    await until(
      () =>
        [...document.querySelectorAll('.shiye-markdown h1')].some((n) => n.textContent === marker),
      '真实消息 Markdown 渲染',
    );
    await window.shiyeRoomUi.command('flush');
    await window.shiyeJournal.flush();
    expect(!(await window.shiyeJournal.status()).lastError, '真实发送到本机日记接口成功');
    result.marker = marker;
    let editor;
    window.dispatchEvent(
      new CustomEvent('shiye-editor-request', {
        detail: {
          receive: (value) => {
            editor = value;
          },
        },
      }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d').fillStyle = '#314947';
    canvas.getContext('2d').fillRect(0, 0, 640, 480);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    result.imageHash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    ]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    result.imageBytes = blob.size;
    editor.files([new File([blob], '归篇原图.png', { type: 'image/png' })]);
    await until(
      () =>
        document.querySelector('[aria-label="确认发送"]') &&
        !document.querySelector('[aria-label="确认发送"]').disabled,
      '图片发送预览',
    );
    await trustedClick(document.querySelector('[aria-label="确认发送"]'));
    await until(() => !document.querySelector('#editable-message-text-modal'), '图片发送完成');
    await wait(1000);
    await window.shiyeRoomUi.command('flush');
    await window.shiyeJournal.flush();
    expect(!(await window.shiyeJournal.status()).lastError, '图片原字节桥接入库成功');
    await window.shiyeJournal.flush();
    expect(!(await window.shiyeJournal.status()).lastError, '重复检查不重复归档');
    window.dispatchEvent(new CustomEvent('shiye-edit-room', { detail: { id: room.id } }));
    await until(
      () => document.querySelector('dialog[open] [name=archiveEnabled]'),
      '重新打开逐对话设置',
    );
    const edit = document.querySelector('dialog[open] form');
    expect(
      edit.elements.category.value === '日常' &&
        edit.elements.archiveEnabled.checked &&
        edit.elements.idleHours.value === '5',
      '分类与自动归档设置恢复',
    );
    edit.querySelector('[data-cancel]').click();
    let blocked = false;
    try {
      await fetch('https://telegram.org/');
    } catch {
      blocked = true;
    }
    expect(blocked, '日记桥接没有放开 Telegram 网络访问');
    localStorage.setItem(
      'shiye-journal-proof',
      JSON.stringify({
        roomId: result.roomId,
        marker: result.marker,
        imageHash: result.imageHash,
        imageBytes: result.imageBytes,
      }),
    );
    result.phase = 'initial';
  } catch (error) {
    result.errors.push(error.stack || String(error));
  }
  chrome.webview.postMessage(result);
})();
