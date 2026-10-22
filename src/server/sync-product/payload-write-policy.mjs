/** Packed values are whole snapshots. A stale pointer must never win a field merge. */
export const PRODUCT_PAYLOAD_WRITES = Object.freeze({
  version: 1,
  conflict: 'strict-base-revision',
  maxBytes: 64 * 1024 * 1024,
});
const reject = (code) => {
  throw Object.assign(new Error(code), { status: 409, code });
};
export function guardProductPayloadWrite(operation, previous) {
  if (operation.entityType !== 'journalAggregate') return;
  const supplied = operation.command === 'create' ? operation.data : operation.changes;
  const oldPointer = previous?.data?._product?.payload;
  const metadata = supplied?._product || previous?.data?._product;
  if (!oldPointer && !metadata?.payload) return;
  if (previous && operation.baseRevision !== previous.revision)
    reject('PRODUCT_PAYLOAD_REBASE_REQUIRED');
  if (metadata?.payload && supplied && Object.keys(supplied).some((key) => key !== '_product'))
    reject('PRODUCT_PAYLOAD_ENVELOPE_REQUIRED');
  if (oldPointer && operation.command === 'updateFields' && !supplied?._product)
    reject('PRODUCT_PAYLOAD_VALUE_REQUIRED');
  // Pointer values own the complete data. Do not retain stale inline body/title
  // beside a newly packed value when an Entry crosses the inline threshold.
  if (metadata?.payload && supplied)
    return { replaceData: { _product: structuredClone(metadata) } };
}
