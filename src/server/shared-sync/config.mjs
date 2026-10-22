import path from 'node:path';
/** Deployment is explicit. A wide listener never enables the legacy business API
 * remotely; only shared/v1 has paired device access, enforced in app.mjs.
 */
export function sharedBusinessConfig(value) {
  if (value === undefined) return { sharedSync: false, sharedRemote: false };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !['enabled', 'remote', 'listenHost', 'sourceCollection'].includes(k),
    ) ||
    typeof value.enabled !== 'boolean'
  )
    throw Error('Shared backend config is invalid');
  const remote = value.remote ?? false;
  if (
    remote !== false &&
    (!remote || typeof remote !== 'object' || Array.isArray(remote) || remote.enabled !== true)
  )
    throw Error('Shared remote must be explicit');
  if (remote !== false && !value.enabled)
    throw Error('Shared remote requires shared business sync');
  const result = { sharedSync: value.enabled, sharedRemote: remote };
  if (value.sourceCollection !== undefined) {
    const collection = value.sourceCollection;
    if (
      !value.enabled ||
      !collection ||
      typeof collection !== 'object' ||
      Array.isArray(collection) ||
      Object.keys(collection).join(',') !== 'exportsDir' ||
      !path.isAbsolute(collection.exportsDir || '')
    )
      throw Error('Source collection requires an explicit private export root');
    result.sourceCollection = { exportsDir: path.resolve(collection.exportsDir) };
  }
  if (value.listenHost !== undefined) {
    const host = value.listenHost === 'localhost' ? '127.0.0.1' : value.listenHost;
    if (!['127.0.0.1', '0.0.0.0', '::'].includes(host))
      throw Error('Shared listener must keep the existing IPv4 loopback desktop route');
    if (host !== '127.0.0.1' && remote === false)
      throw Error('Shared wide listener requires paired remote access');
    result.host = host;
  }
  return result;
}
