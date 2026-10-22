// Exact pure formatter extracted from previews/telegram-chat/shiye-journal.js; no application imports.
// Source body SHA256: cb58a22dabd52166982f0cd76e16dedc27a752f2cfff66dd1d92c914fe100a7a
// A targeted AST/body check requires explicit synchronization if the PC algorithm changes.
// prettier-ignore
export function formatDesktopJournalText(message) {
    const text = String(message.message || '');
    const markers = {
      MessageEntityBold: '**',
      MessageEntityItalic: '*',
      MessageEntityStrike: '~~',
      MessageEntityCode: '`',
      MessageEntityPre: '```',
    };
    const edits = [];
    for (const e of message.entities || []) {
      const mark = markers[e.shiyeType];
      if (
        !mark ||
        !Number.isInteger(e.offset) ||
        e.length <= 0 ||
        e.offset < 0 ||
        e.offset + e.length > text.length
      )
        continue;
      edits.push({
        at: e.offset,
        value:
          mark === '```'
            ? `\n\n\`\`\`${String(e.language || '').replace(/[^a-z0-9_+-]/gi, '')}\n`
            : mark,
        close: false,
      });
      edits.push({
        at: e.offset + e.length,
        value: mark === '```' ? '\n```\n\n' : mark,
        close: true,
      });
    }
    let result = text;
    for (const edit of edits.sort((a, b) => b.at - a.at || Number(a.close) - Number(b.close)))
      result = result.slice(0, edit.at) + edit.value + result.slice(edit.at);
    return result;
  }
export const DESKTOP_JOURNAL_FORMATTER_BODY_SHA256 =
  'cb58a22dabd52166982f0cd76e16dedc27a752f2cfff66dd1d92c914fe100a7a';
