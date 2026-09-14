const enc = new TextEncoder(),
  dec = new TextDecoder();
export const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
};
export const fromBase64 = (s) => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
  const raw = atob(s),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};
async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
function aad(h) {
  return enc.encode(
    JSON.stringify([h.format, h.version, h.kdf, h.iterations, h.cipher, h.salt, h.iv]),
  );
}
export async function encryptVault(payload, password) {
  if (typeof password !== 'string' || password.length < 12)
    throw Error('请使用至少 12 个字符的备份密码');
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const h = {
    format: 'shiye-vault',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 600000,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
  };
  const key = await derive(password, salt),
    encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(h), tagLength: 128 },
      key,
      enc.encode(JSON.stringify(payload)),
    );
  return { ...h, data: toBase64(new Uint8Array(encrypted)) };
}
export async function decryptVault(v, password) {
  if (
    v?.format !== 'shiye-vault' ||
    v.version !== 1 ||
    v.kdf !== 'PBKDF2-SHA256' ||
    v.iterations !== 600000 ||
    v.cipher !== 'AES-256-GCM' ||
    typeof v.data !== 'string'
  )
    throw Error('不支持的加密备份格式');
  try {
    const salt = fromBase64(v.salt),
      iv = fromBase64(v.iv);
    if (salt.length !== 16 || iv.length !== 12) throw Error();
    const key = await derive(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(v), tagLength: 128 },
      key,
      fromBase64(v.data),
    );
    return JSON.parse(dec.decode(plain));
  } catch {
    throw Error('密码不正确，或备份已损坏／被改动');
  }
}
