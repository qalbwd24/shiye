import { uploadMediaFile } from '../core/api.js';
import { compressUpload } from '../core/media-compression.js';
import { chooseMediaBatch } from './media-batch.js';
import { avatarStyle } from '../shared/profile.js';

/** Local social-style comments. Identity is snapshotted by the server on creation. */
export function createComments(c) {
  const host = c.$('#entryComments'),
    drafts = new Map(),
    expanded = new Set();
  let shown = null,
    editing = null,
    replying = null,
    busy = false,
    uploading = false;
  const profile = () => c.library.settings?.preferences?.profile || {};
  const key = () => shown + ':' + (editing || 'reply-' + (replying || 'new'));
  const current = () => c.library.entries.find((e) => e.id === shown);
  const stamp = (v) => new Date(v).toLocaleString('zh-CN', { hour12: false });
  function draft() {
    if (!drafts.has(key())) {
      const old = current()?.comments?.find((v) => v.id === editing);
      drafts.set(key(), {
        body: old?.body || '',
        attachments: [...(old?.attachments || [])],
        changed: false,
        revision: old?.revision,
      });
    }
    return drafts.get(key());
  }
  function image(id, name, cls = '', crop) {
    const media = c.library.media.find((m) => m.id === id && m.type?.startsWith('image/'));
    return media
      ? `<img class="${cls}" ${crop ? `style="${avatarStyle(crop)}"` : ''} src="/media/${encodeURIComponent(id)}" alt="${c.escape(name)}" loading="lazy" draggable="false">`
      : `<span class="comment-avatar-fallback">${c.escape((name || '我').slice(0, 1))}</span>`;
  }
  function photos(ids, removing = false) {
    return `<div class="comment-photos">${ids.map((id) => `<div><button type="button" data-comment-photo="${c.escape(id)}" aria-label="查看评论原图">${image(id, '评论图片')}</button>${removing ? `<button type="button" class="comment-photo-remove" data-comment-photo-remove="${c.escape(id)}" aria-label="移除待发图片">×</button>` : ''}</div>`).join('')}</div>`;
  }
  function row(v, entry, index) {
    return `<article class="self-comment ${v.deleted ? 'is-deleted' : ''}" data-comment-id="${v.id}"><div class="comment-avatar">${image(v.authorAvatarId, v.authorName || '我', '', v.authorAvatarCrop || {})}</div><div class="comment-main"><header><b>${c.escape(v.authorName || '我')}</b><span class="comment-self-tag">自己</span><small>#${index + 1}</small></header>${v.replyPreview ? `<blockquote class="comment-quote"><b>回复 ${c.escape(v.replyPreview.authorName || '我')}</b><span>${c.escape(v.replyPreview.body || '[图片]')}</span></blockquote>` : ''}<p>${c.escape(v.deleted ? '这条评论已移除，可恢复。' : v.body)}</p>${v.deleted ? '' : photos(v.attachments || [])}<footer><time title="${c.escape(v.createdAt)}">${c.escape(stamp(v.createdAt))}</time>${v.updatedAt !== v.createdAt ? '<small>已修改</small>' : ''}${!entry.deleted ? `<div class="comment-actions">${v.deleted ? `<button data-comment-restore="${v.id}">恢复</button>` : `<button data-comment-reply="${v.id}">回复</button><button data-comment-edit="${v.id}">编辑</button><button data-comment-remove="${v.id}">移除</button>`}</div>` : ''}</footer></div></article>`;
  }
  function render(entry) {
    if (!host) return;
    if (shown !== entry?.id) {
      editing = null;
      replying = null;
    }
    shown = entry?.id || null;
    host.hidden = !entry;
    if (!entry) {
      host.innerHTML = '';
      return;
    }
    const comments = entry.comments || [],
      byId = new Map(comments.map((v) => [v.id, v]));
    const groups = new Map();
    for (const v of comments) {
      let root = v,
        seen = new Set([v.id]);
      while (root.replyTo && byId.has(root.replyTo) && !seen.has(root.replyTo)) {
        root = byId.get(root.replyTo);
        seen.add(root.id);
      }
      if (!groups.has(root.id)) groups.set(root.id, []);
      groups.get(root.id).push(v);
    }
    const target = comments.find((v) => v.id === (editing || replying)),
      d = draft();
    host.innerHTML = `<header class="comments-heading"><div><h3>评论 <span>${comments.filter((v) => !v.deleted).length}</span></h3><small>和过去的自己聊一聊</small></div></header><div class="comment-list">${
      [...groups]
        .map(([id, items]) => {
          const root = byId.get(id),
            replies = items.filter((v) => v.id !== id);
          return (
            row(root, entry, comments.indexOf(root)) +
            (replies.length
              ? `<details class="comment-replies" data-reply-group="${id}" ${expanded.has(shown + id) ? 'open' : ''}><summary>展开 ${replies.length} 条回复</summary>${replies.map((v) => row(v, entry, comments.indexOf(v))).join('')}</details>`
              : '')
          );
        })
        .join('') ||
      '<div class="comments-empty"><span>◌</span><p>这里留给新的想法</p><small>可以补充照片，也可以回复过去的自己。</small></div>'
    }</div>${!entry.deleted ? `<form class="comment-form"><button type="button" class="comment-identity" data-comment-profile><span class="comment-avatar">${image(profile().authorAvatarId, profile().authorName || '我', '', profile().authorAvatarCrop || {})}</span><span>${c.escape(profile().authorName || '我')}</span><small>个人资料</small></button>${target ? `<div class="comment-replying"><b>${editing ? '编辑评论' : '回复 ' + c.escape(target.authorName || '我')}</b><span>${c.escape(target.body?.slice(0, 120) || '[图片]')}</span><button type="button" data-comment-cancel aria-label="取消编辑或回复">×</button></div>` : ''}<label class="sr-only" for="selfCommentBody">评论内容</label><textarea id="selfCommentBody" rows="3" maxlength="10000" placeholder="留下此刻的想法…">${c.escape(d.body)}</textarea>${photos(d.attachments, true)}<div class="comment-compose-tools"><button type="button" class="secondary" data-comment-images ${uploading ? 'disabled' : ''}>${uploading ? '上传中…' : '＋ 图片 / GIF'}</button><input type="file" id="commentImagesFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden><button type="button" class="secondary" data-comment-stickers>表情包</button><button type="button" class="secondary" data-comment-emoji aria-label="插入表情">☺</button><button class="primary" type="submit" ${busy || uploading ? 'disabled' : ''}>${editing ? '保存修改' : replying ? '回复' : '评论'}</button></div><div class="comment-emoji" hidden>${['🙂', '😊', '❤️', '👍', '🌿', '🎉', '🥲', '🤔', '✨', '💪', '😂', '☀️'].map((v) => `<button type="button" data-emoji="${v}">${v}</button>`).join('')}</div><small class="comment-local-note">仅保存在本地 · 随加密备份保存</small></form>` : ''}`;
    host.querySelectorAll('[data-reply-group]').forEach((el) =>
      el.addEventListener('toggle', () => {
        const id = shown + el.dataset.replyGroup;
        if (el.open) expanded.add(id);
        else expanded.delete(id);
        el.querySelector('summary').textContent =
          (el.open ? '收起' : '展开') +
          ' ' +
          el.querySelectorAll('.self-comment').length +
          ' 条回复';
      }),
    );
  }
  host?.addEventListener('input', (event) => {
    if (event.target.id === 'selfCommentBody') {
      draft().body = event.target.value;
      draft().changed = true;
    }
  });
  async function save(commentId, data) {
    if (busy || uploading) return;
    const entryId = shown,
      draftKey = key(),
      pendingDraft = drafts.get(key()),
      pendingSnapshot = JSON.stringify(pendingDraft);
    busy = true;
    try {
      await c.withLibraryMutation(async () => {
        const entry = c.library.entries.find((e) => e.id === entryId),
          old = entry?.comments?.find((v) => v.id === commentId);
        const saved = await c.api(
          `/api/entries/${entryId}/comments${commentId ? '/' + commentId : ''}`,
          {
            method: commentId ? 'PUT' : 'POST',
            data: {
              ...data,
              entryRevision: entry?.revision,
              revision: commentId && 'body' in data ? pendingDraft?.revision : old?.revision,
            },
          },
        );
        Object.assign(c.library.entries.find((e) => e.id === entryId) || entry, saved);
      });
      if ('body' in data && JSON.stringify(drafts.get(draftKey)) === pendingSnapshot)
        drafts.delete(draftKey);
      if (shown === entryId) {
        editing = null;
        replying = null;
        render(c.current());
      }
      c.toast(data.deleted ? '评论已移除，可在原位置恢复' : '评论已保存');
    } catch (error) {
      c.toast(error.message);
    } finally {
      busy = false;
      host?.querySelector('[type=submit]')?.removeAttribute('disabled');
    }
  }
  host?.addEventListener('submit', (event) => {
    event.preventDefault();
    const d = draft();
    if (!d.body.trim() && !d.attachments.length) return c.toast('请输入评论或选择图片');
    void save(editing, {
      body: d.body.trim(),
      attachments: d.attachments,
      ...(!editing
        ? {
            authorName: profile().authorName || '我',
            authorAvatarCrop: profile().authorAvatarCrop || { x: 50, y: 50, zoom: 1 },
            authorAvatarId: c.library.media.some((m) => m.id === profile().authorAvatarId)
              ? profile().authorAvatarId
              : '',
            replyTo: replying || '',
          }
        : {}),
    });
  });
  async function upload(files) {
    if (uploading || busy || !files.length) return;
    const d = draft();
    uploading = true;
    try {
      let quality = 'balanced';
      try {
        quality = localStorage.getItem('shiye.media-quality') || quality;
      } catch {
        /* Use the default. */
      }
      const chosen = await chooseMediaBatch([...files], {
        escape: c.escape,
        quality,
        targetLabel: '这条评论的草稿',
      });
      if (d.attachments.length + chosen.length > 9) throw Error('每条评论最多 9 张图片');
      for (const selection of chosen) {
        const file = selection.file;
        if (
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)
        )
          throw Error('评论支持 PNG、JPEG、WebP、GIF 和 AVIF 图片');
        const processed = await compressUpload(file, { quality: selection.quality });
        const media = await uploadMediaFile(processed.file, () => {}, {
          ...processed,
          quality: selection.quality,
          compression: processed.changed ? 'image-canvas' : null,
        });
        if (!c.library.media.some((m) => m.id === media.id)) c.library.media.push(media);
        if (!d.attachments.includes(media.id)) {
          d.attachments.push(media.id);
          d.changed = true;
        }
      }
      if (chosen.length) c.toast('图片已加入评论草稿');
    } catch (error) {
      c.toast(error.message);
    } finally {
      uploading = false;
      render(c.current());
    }
  }
  host?.addEventListener('change', (event) => {
    if (event.target.id === 'commentImagesFile') void upload(event.target.files);
  });
  host?.addEventListener('click', (event) => {
    const b = event.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.commentPhoto) {
      c.modal(
        '评论原图',
        `<img class="comment-full-image" src="/media/${encodeURIComponent(b.dataset.commentPhoto)}" alt="评论完整图片">`,
      );
    } else if (b.dataset.commentEdit) {
      editing = b.dataset.commentEdit;
      replying = null;
      render(c.current());
      host.querySelector('textarea').focus();
    } else if (b.dataset.commentReply) {
      replying = b.dataset.commentReply;
      editing = null;
      render(c.current());
      host.querySelector('textarea').focus();
    } else if (b.hasAttribute('data-comment-cancel')) {
      drafts.delete(key());
      editing = null;
      replying = null;
      render(c.current());
    } else if (b.dataset.commentRemove) void save(b.dataset.commentRemove, { deleted: true });
    else if (b.dataset.commentRestore) void save(b.dataset.commentRestore, { deleted: false });
    else if (b.hasAttribute('data-comment-images'))
      host.querySelector('#commentImagesFile').click();
    else if (b.hasAttribute('data-comment-profile')) c.$('#profileButton').click();
    else if (b.hasAttribute('data-comment-stickers')) {
      const targetDraft = draft(),
        targetEntry = shown;
      c.stickers.pick((id) => {
        if (targetDraft.attachments.includes(id)) return;
        if (targetDraft.attachments.length >= 9) return c.toast('每条评论最多 9 张图片');
        targetDraft.attachments.push(id);
        targetDraft.changed = true;
        if (shown === targetEntry) render(c.current());
      });
    } else if (b.dataset.commentPhotoRemove) {
      const d = draft();
      d.attachments = d.attachments.filter((id) => id !== b.dataset.commentPhotoRemove);
      d.changed = true;
      render(c.current());
    } else if (b.hasAttribute('data-comment-emoji')) {
      const el = host.querySelector('.comment-emoji');
      el.hidden = !el.hidden;
    } else if (b.dataset.emoji) {
      const d = draft();
      d.body += b.dataset.emoji;
      d.changed = true;
      host.querySelector('textarea').value = d.body;
      host.querySelector('textarea').focus();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (
      uploading ||
      [...drafts.values()].some((v) => v.changed && (v.body.trim() || v.attachments.length))
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('shiye:profile-change', () => render(c.current()));
  return { render };
}
