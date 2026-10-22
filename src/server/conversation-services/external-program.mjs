import { fail } from '../http.mjs';

/** Declarative participant only. Its process/model is hosted elsewhere. */
export function configureExternalProgram(previous, input, name) {
  const allowed = new Set(['enabled', 'title', 'sender', 'kind', 'parameters']);
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.has(key))
  )
    throw fail(400, '外部程序参数不正确');
  const value = {
    enabled: false,
    title: name,
    sender: { name },
    kind: 'program',
    parameters: {},
    ...previous,
    ...input,
  };
  if (
    typeof value.enabled !== 'boolean' ||
    !['program', 'ai'].includes(value.kind) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 80 ||
    typeof value.sender?.name !== 'string' ||
    !value.sender.name.trim() ||
    value.sender.name.length > 80 ||
    !value.parameters ||
    typeof value.parameters !== 'object' ||
    Array.isArray(value.parameters) ||
    Buffer.byteLength(JSON.stringify(value.parameters)) > 16384
  )
    throw fail(400, '程序名称、类型、开关或参数不正确');
  return {
    version: 1,
    revision: (previous?.revision || 0) + 1,
    enabled: value.enabled,
    title: value.title.trim(),
    kind: value.kind,
    sender: { id: 'external-program', name: value.sender.name.trim(), avatarAssetId: null },
    parameters: structuredClone(value.parameters),
  };
}
