(() => {
  window.shiyeInstallFiles = (request) => {
    let busy = false;
    window.shiyeAndroidFiles = {
      async export({ blob, name, mimeType, action = 'save' }) {
        if (busy) throw Error('请先完成当前文件保存');
        if (!(blob instanceof Blob) || blob.size > 64 * 1024 * 1024) throw Error('文件需小于64MB');
        busy = true;
        const token = crypto.randomUUID();
        try {
          await request('file-begin', { token, name, mimeType, action, size: blob.size });
          for (let offset = 0; offset < blob.size; offset += 196608) {
            const bytes = new Uint8Array(await blob.slice(offset, offset + 196608).arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192)
              binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await request('file-chunk', { token, offset, data: btoa(binary) });
          }
          return await request('file-finish', { token });
        } catch (error) {
          if (token) await request('file-cancel', { token }).catch(() => {});
          throw error;
        } finally {
          busy = false;
        }
      },
    };
    window.shiyeAndroidSettings = { open: () => request('app-settings', {}) };
  };
})();
