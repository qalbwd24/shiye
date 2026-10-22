import { isHidden, dayKey } from '../shared/insights.js';
import {
  projectOpenEntry,
  OPEN_DATA_API_VERSION,
  OPEN_DATA_SCHEMA_VERSION,
  OPEN_DATA_TIME_ZONE,
} from '../shared/open-data.js';

/** Feature-local state; c.library is a live getter, never a cached snapshot. */
export function createExport(c) {
  const { $, escape: esc, modal, toast, textOf, sanitize } = c;

  function exported(entries) {
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>日记导出</title><style>body{max-width:850px;margin:36px auto;font:18px/1.9 sans-serif}article{break-after:page}img,video{max-width:100%}blockquote{border-left:3px solid #888;padding-left:20px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}</style>${entries
      .map(
        (e) =>
          `<article><h1>${esc(e.title || '无标题日记')}</h1><p>${esc(dayKey(e.date) + ' · ' + e.category + ' · ' + e.tags.join('、'))}</p>${sanitize(e.content).replaceAll('src="/media/', 'src="' + location.origin + '/media/')}${e.attachments
            .filter(
              (id) => !sanitize(e.content).includes('src="/media/' + encodeURIComponent(id) + '"'),
            )
            .map((id) => {
              const m = c.library.media.find((m) => m.id === id);
              return m?.type.startsWith('image/')
                ? `<img src="${location.origin}/media/${id}" alt="${esc(m.name)}">`
                : m
                  ? `<p>附件：${esc(m.name)}</p>`
                  : '';
            })
            .join('')}</article>`,
      )
      .join('')}</html>`;
  }
  async function exportMenu(entryId = null) {
    await c.flush();
    modal(
      '本地导出',
      `<label>范围<select class="field" id="exportScope"><option value="current">当前日记</option><option value="visible">当前列表</option><option value="all">全部非隐藏日记</option></select></label><button class="option-button" id="exportJson">导出结构化 JSON（AI／组件）</button><label><input type="checkbox" id="exportComments"> JSON 包含评论</label><button class="option-button" id="exportText">导出纯文本 TXT</button><button class="option-button" id="exportHtml">导出带图片的 HTML</button><button class="option-button" id="printDiary">打印／保存 PDF</button><button class="option-button" id="exportPng">当前日记导出文字长图 PNG</button><p>JSON 保留正文源格式与附件信息，不包含媒体文件；完整保存请使用加密备份。HTML 会嵌入图片，可离线打开；PDF 通过浏览器打印对话框保存。</p>`,
    );
    const entries = () =>
      $('#exportScope').value === 'current'
        ? [entryId ? c.library.entries.find((e) => e.id === entryId) : c.current()].filter(Boolean)
        : $('#exportScope').value === 'visible'
          ? c.filtered()
          : c.library.entries.filter((e) => !e.deleted && !e.draft && !isHidden(e));
    $('#exportJson').onclick = () => {
      const media = new Map(c.library.media.map((m) => [m.id, m]));
      const result = {
        format: 'shiye-open-data',
        apiVersion: OPEN_DATA_API_VERSION,
        schemaVersion: OPEN_DATA_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        timeZone: OPEN_DATA_TIME_ZONE,
        entries: entries().map((e) =>
          projectOpenEntry(e, media, { includeComments: $('#exportComments').checked }),
        ),
      };
      c.download(
        '拾页结构化日记',
        'application/json;charset=utf-8',
        JSON.stringify(result, null, 2),
        'json',
      );
    };
    $('#exportText').onclick = () =>
      c.download(
        '拾页日记',
        'text/plain;charset=utf-8',
        entries()
          .map(
            (e) =>
              `${e.title}\n${dayKey(e.date)} · ${e.category} · ${e.tags.join('、')}\n\n${textOf(e.content)}\n\n`,
          )
          .join('\n──────────\n'),
        'txt',
      );
    $('#exportHtml').onclick = async () => {
      let html = exported(entries());
      for (const m of c.library.media.filter(
        (m) => m.type.startsWith('image/') && html.includes('/media/' + m.id),
      )) {
        const b = await (await fetch('/media/' + m.id)).blob(),
          data = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(b);
          });
        html = html.replaceAll(location.origin + '/media/' + m.id, data);
      }
      c.download('拾页图文日记', 'text/html;charset=utf-8', html, 'html');
    };
    $('#printDiary').onclick = () => {
      let area = $('#printArea');
      if (!area) {
        area = document.createElement('section');
        area.id = 'printArea';
        document.body.append(area);
      }
      const doc = new DOMParser().parseFromString(exported(entries()), 'text/html');
      area.innerHTML = doc.body.innerHTML;
      const imgs = [...area.querySelectorAll('img')];
      Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => window.print());
    };
    $('#exportPng').onclick = () => {
      const e = entryId ? c.library.entries.find((e) => e.id === entryId) : c.current();
      if (!e) return;
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d'),
        words = Array.from(e.title + '\n' + dayKey(e.date) + '\n\n' + textOf(e.content)),
        lines = [];
      ctx.font = '24px Microsoft YaHei';
      let line = '';
      for (const char of words) {
        if (char === '\n' || ctx.measureText(line + char).width > 820) {
          lines.push(line);
          line = char === '\n' ? '' : char;
        } else line += char;
      }
      lines.push(line);
      if (lines.length > 450) return toast('正文太长，请使用 PDF 导出');
      canvas.width = 900;
      canvas.height = 100 + lines.length * 40;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '24px Microsoft YaHei';
      ctx.fillStyle = '#26363b';
      lines.forEach((t, i) => ctx.fillText(t, 40, 60 + i * 40));
      canvas.toBlob((b) => c.download('日记长图', 'image/png', b, 'png'));
    };
  }

  return { exportMenu };
}
