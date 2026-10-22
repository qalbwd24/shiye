import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const fail = (code) => {
  throw Object.assign(Error(code), { code, status: 409 });
};
export function deferredMediaProof(db, input, operationId) {
  const declaration = input.deferredMedia,
    message = input.messages?.[0];
  if (
    !declaration ||
    Object.keys(declaration).some((k) => k !== 'uploadOperationIds') ||
    !Array.isArray(declaration.uploadOperationIds) ||
    !Array.isArray(input.messages) ||
    input.messages.length !== 1 ||
    !message ||
    message.replacementOf ||
    message.replacementRootId ||
    !Array.isArray(message.attachments) ||
    !message.attachments.length ||
    declaration.uploadOperationIds.length !== message.attachments.length ||
    new Set(declaration.uploadOperationIds).size !== declaration.uploadOperationIds.length
  )
    fail('SHARED_INVALID_DEFERRED_MEDIA');
  return declaration.uploadOperationIds.map((id, index) => {
    if (!uuid(id)) fail('SHARED_INVALID_DEFERRED_MEDIA');
    const receipt = db._sharedMedia?.find((row) => row.operationId === id),
      asset = receipt?.result;
    const media = db.media.find((item) => item.id === asset?.id);
    if (
      !asset ||
      !uuid(asset.id) ||
      asset.id !== message.attachments[index] ||
      !media ||
      media.size !== asset.size ||
      media.sha256 !== asset.sha256 ||
      media.type !== asset.type ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      fail('SHARED_DEFERRED_MEDIA_NOT_COMPLETE');
    if (receipt.deferredMessage && receipt.deferredMessage.operationId !== operationId)
      fail('SHARED_DEFERRED_MEDIA_ALREADY_USED');
    return { operationId: id, assetId: asset.id, size: asset.size, sha256: asset.sha256 };
  });
}
export async function verifyDeferredMedia(db, input, operationId, dataDir) {
  const proof = deferredMediaProof(db, input, operationId);
  for (const item of proof) {
    const file = path.join(dataDir, 'media', item.assetId);
    try {
      if ((await fs.stat(file)).size !== item.size)
        fail('SHARED_DEFERRED_MEDIA_ORIGINAL_UNAVAILABLE');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== item.sha256) fail('SHARED_DEFERRED_MEDIA_ORIGINAL_UNAVAILABLE');
    } catch (error) {
      if (error.code === 'ENOENT') fail('SHARED_DEFERRED_MEDIA_ORIGINAL_UNAVAILABLE');
      throw error;
    }
  }
  return proof;
}
export function claimDeferredMedia(db, input, operationId, proof) {
  const current = deferredMediaProof(db, input, operationId);
  if (JSON.stringify(current) !== JSON.stringify(proof)) fail('SHARED_DEFERRED_MEDIA_CHANGED');
  for (const item of current) {
    const receipt = db._sharedMedia.find((row) => row.operationId === item.operationId);
    receipt.deferredMessage = {
      operationId,
      sourceId: input.sourceId,
      roomId: input.roomId,
      messageId: input.messages[0].id,
      sentAt: input.messages[0].sentAt,
    };
  }
}
