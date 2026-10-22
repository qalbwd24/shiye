export function createRichTextLabEntry(c) {
  return {
    settings() {
      c.modal(
        '图文试写 · 第一步',
        '<p>在独立试验草稿中验证富文本、文中图片和消息阅读；旧日记不改格式。</p><a class="option-button" href="http://127.0.0.1:18766/rich-text-lab.html" target="_blank" rel="noopener">打开图文试写</a><a class="option-button" href="http://127.0.0.1:18766/?quick=1&amp;richdoc=1" target="_blank" rel="noopener">打开新版快捷窗（开发库）</a><p>新版快捷窗只为新篇使用图文格式，保存到独立开发日记库；旧篇继续原编辑方式。需要更新后的开发服务运行，不能用旧服务验收保存。试验草稿仍单独保存在当前浏览器，完整保留请导出原件。</p>',
      );
    },
  };
}
