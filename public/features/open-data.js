/** Integration entry points; all requests still pass through the local diary service. */
export function createOpenData(c, { exportMenu, richTextLab }) {
  async function settings() {
    await c.flush();
    const base = location.origin;
    c.modal(
      '组件与 AI 数据',
      `<p>日记独立管理。AI 工具和自定义组件可读取版本化 JSON 接口，或使用导出的文件。</p><label>本地读取接口<input class="field" readonly value="${c.escape(base + '/api/open/v1/entries')}"></label><label>接口结构说明<input class="field" readonly value="${c.escape(base + '/api/open/v1/schema')}"></label><button class="option-button" id="openStructuredExport">导出结构化 JSON</button><a class="option-button" href="/components/diary-card.html" target="_blank" rel="noopener">打开日记组件示例</a><p>组件示例支持最近记录、随机回忆、往日此时和置顶。外部桌面程序可通过本机服务读取；浏览器组件使用同服务页面或自己的后端连接。</p><p>JSON 包含所选正文与附件信息；媒体文件仍在本地。AI 服务的接入与内容发送由你使用的工具控制。</p>`,
    );
    c.$('#openStructuredExport').onclick = () =>
      exportMenu().catch((error) => c.toast(error.message));
    if (richTextLab) {
      const button = document.createElement('button');
      button.className = 'option-button';
      button.textContent = '图文试写（独立草稿）';
      button.onclick = richTextLab.settings;
      c.$('#modalBody').append(button);
    }
  }
  return { settings };
}
