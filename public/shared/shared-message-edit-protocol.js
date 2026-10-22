import { sha256Bytes } from './sync-v2-media.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const fail = () => {
  throw Object.assign(new Error('LOCAL_MESSAGE_EDIT_BASE_UNAVAILABLE'), {
    code: 'LOCAL_MESSAGE_EDIT_BASE_UNAVAILABLE',
    status: 409,
  });
};
const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
export const sharedMessageEditRootId = ({ sourceId, roomId, rootMessageId }) =>
  sha256Bytes(
    new TextEncoder().encode(JSON.stringify(canonical({ sourceId, roomId, rootMessageId }))),
  );
export const sharedMessageEditUnitId = (sourceId, roomId, messageId) =>
  'chat:' + sha256Bytes(new TextEncoder().encode(JSON.stringify([sourceId, roomId, messageId])));

/** Same bytes on server and an offline replica. editBase is a transport-only annotation. */
export function sharedMessageEditHeadSha256(message, headRevision) {
  if (
    !message ||
    typeof message.id !== 'string' ||
    !/^\d{1,20}$/.test(message.id) ||
    !(headRevision === null || (Number.isSafeInteger(headRevision) && headRevision > 0))
  )
    fail();
  const { editBase: _editBase, ...original } = message;
  return sha256Bytes(
    new TextEncoder().encode(
      JSON.stringify(
        canonical({
          protocol: 'shiye-message-edit-base-v1',
          message: original,
          headRevision,
        }),
      ),
    ),
  );
}

/** annotation is received in the signed seed/current authority projection, not an online requirement. */
export function buildLocalMessageEditBase(message, annotation = message?.editBase) {
  if (
    message?.withdrawn ||
    message?.state === 'withdrawn' ||
    !annotation ||
    annotation.headMessageId !== message?.id ||
    !(annotation.editOperationId === null || uuid(annotation.editOperationId))
  )
    fail();
  const headSha256 = sharedMessageEditHeadSha256(message, annotation.headRevision);
  if (annotation.headSha256 !== headSha256) fail();
  return {
    headMessageId: message.id,
    headRevision: annotation.headRevision,
    headSha256,
    editOperationId: annotation.editOperationId,
  };
}
