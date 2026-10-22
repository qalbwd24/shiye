import { productRecord } from '../../../public/shared/sync-product.js';

const mapped = new Set([
  'entries',
  'media',
  'categories',
  'tags',
  'stickers',
  'chatJournal',
  'messageStore',
  'revisit',
  '_sharedSync',
  '_sharedCommands',
  '_sharedMedia',
  '_sharedSeedExports',
]);
const device = new Set([
  'window',
  'windowPosition',
  'windowSize',
  'displays',
  'dpi',
  'deviceId',
  'localPath',
  'filePath',
  'absolutePath',
  'downloadDirectory',
  'stateDirectory',
  'profileDirectory',
]);
const credentialNames = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'privatekey',
  'encryptionkey',
  'pairingkey',
  'cookie',
  'credentials',
  'sessioncookie',
  'authorization',
  'clientsecret',
  'sessiontoken',
  'secretkey',
  'bearertoken',
]);
// Configuration identifiers only: a shortcut's ordinary "key" remains business data.
const isCredentialField = (name) => credentialNames.has(name.replace(/[_\-\s]/g, '').toLowerCase());

function portableUrl(value, location, excluded) {
  if (!/^https?:\/\//i.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  let changed = false;
  if (url.username || url.password) {
    url.username = '';
    url.password = '';
    excluded.push({ path: location, reason: 'credential-url-userinfo' });
    changed = true;
  }
  const names = [...new Set(url.searchParams.keys())].filter(isCredentialField);
  if (names.length) {
    for (const name of names) url.searchParams.delete(name);
    excluded.push({ path: location, reason: 'credential-url-query' });
    changed = true;
  }
  return changed ? url.href : value;
}
const archives = new Set(['sourceArchives', 'rawArchive', 'archiveBytes', 'backupBytes']);
const recordObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const itemCount = (value) =>
  Array.isArray(value)
    ? value.length
    : recordObject(value)
      ? Object.keys(value).length
      : value === null || value === undefined
        ? 0
        : 1;

// Describe the existing adapters precisely. Never preserve skipped message bodies
// in metadata: their owner and withdrawal rules have not been established here.
function domainCoverage(name, value, library, fields, unmapped, excluded) {
  const domain = {
    path: name,
    disposition: 'scoped-adapter-requires-subdomain-review',
    unmappedCount: 0,
  };
  const skip = (location, count, reason = 'NO_PORTABLE_ADAPTER') => {
    const row = { path: location, disposition: 'unmapped-not-exported', count, reason };
    fields.push(row);
    unmapped.push(row);
    domain.disposition = 'partial-adapter';
    domain.unmappedCount += count;
  };
  fields.push(domain);
  if (!recordObject(value)) {
    skip(name, itemCount(value), 'INVALID_DOMAIN_STRUCTURE');
    return;
  }
  const entries = Array.isArray(library.entries) ? library.entries : [];
  const attachedEntries = new Set(
    entries
      .filter((entry) => !entry.chatJournal && value.layouts?.[entry.id])
      .map((entry) => entry.id),
  );
  if (name === 'revisit' && !Object.hasOwn(value, 'config'))
    skip('revisit.config', 0, 'RUNTIME_IMPORT_REQUIRES_CONFIG');
  for (const [key, child] of Object.entries(value)) {
    const location = `${name}.${key}`;
    if (name === 'chatJournal' && key === 'rooms') {
      if (!Array.isArray(child)) skip(location, itemCount(child), 'INVALID_ROOMS_STRUCTURE');
      else
        fields.push({
          path: location,
          disposition: 'typed-conversation-adapter',
          count: child.length,
        });
    } else if (name === 'messageStore' && key === 'units') {
      if (!Array.isArray(child)) {
        skip(location, itemCount(child), 'INVALID_UNITS_STRUCTURE');
        continue;
      }
      const mappedCount = child.filter(
        (unit) => unit?.origin?.kind === 'diary' && attachedEntries.has(unit.origin.entryId),
      ).length;
      fields.push({
        path: location,
        disposition: 'attached-diary-canonical-subset',
        count: child.length,
        mappedCount,
        unmappedCount: child.length - mappedCount,
      });
      if (mappedCount < child.length)
        skip(location, child.length - mappedCount, 'UNATTACHED_OR_NON_DIARY_UNITS');
    } else if (name === 'messageStore' && key === 'layouts') {
      if (!recordObject(child)) {
        skip(location, itemCount(child), 'INVALID_LAYOUTS_STRUCTURE');
        continue;
      }
      const mappedCount = Object.keys(child).filter((id) => attachedEntries.has(id)).length;
      fields.push({
        path: location,
        disposition: 'attached-diary-canonical-subset',
        count: Object.keys(child).length,
        mappedCount,
        unmappedCount: Object.keys(child).length - mappedCount,
      });
      if (mappedCount < Object.keys(child).length)
        skip(location, Object.keys(child).length - mappedCount, 'UNATTACHED_OR_CHAT_LAYOUTS');
    } else if (name === 'revisit') {
      if (['config', 'comments', 'deliveries'].includes(key)) {
        if (key === 'config' ? !recordObject(child) : !Array.isArray(child)) {
          skip(location, itemCount(child), 'INVALID_RUNTIME_BUSINESS_STRUCTURE');
          continue;
        }
        fields.push({
          path: location,
          disposition: 'business-adapter-via-import-runtime',
          count: itemCount(child),
        });
      } else {
        fields.push({
          path: location,
          disposition: 'server-private-runtime-not-exported',
          count: itemCount(child),
        });
        excluded.push({ path: location, reason: 'server-private-runtime' });
      }
    } else skip(location, itemCount(child));
  }
}

// A phone receives configuration/history, never the desktop runner's private continuation state.
function serviceRegistry(value, excluded) {
  const result = structuredClone(value);
  if (!result || typeof result !== 'object') return result;
  if (Object.hasOwn(result, 'settingsOperations')) {
    delete result.settingsOperations;
    excluded.push({
      path: 'conversationServices.settingsOperations',
      reason: 'server-private-runtime',
    });
  }
  for (const [i, instance] of (result.instances || []).entries()) {
    if (!instance.state || typeof instance.state !== 'object') continue;
    for (const key of Object.keys(instance.state)) {
      if (['config', 'comments', 'deliveries'].includes(key)) continue;
      delete instance.state[key];
      excluded.push({
        path: `conversationServices.instances[${i}].state.${key}`,
        reason: 'server-private-runtime',
      });
    }
    // Withdrawn comment text is never transported in a compatibility envelope either.
    instance.state.comments = (instance.state.comments || []).map((comment) => {
      if (comment.state !== 'withdrawn' && !comment.withdrawn) return comment;
      return Object.fromEntries(
        Object.entries(comment).filter(([key]) =>
          [
            'id',
            'operationId',
            'state',
            'withdrawn',
            'withdrawnAt',
            'batchId',
            'deliveryId',
            'source',
            'createdAt',
            'updatedAt',
            'revision',
          ].includes(key),
        ),
      );
    });
  }
  return result;
}

/** Configuration only. Never run this over diary/message bodies or media bytes. */
export function portableConfiguration(value, { path = '', excluded = [] } = {}) {
  if (Array.isArray(value))
    return value.map((v, i) => portableConfiguration(v, { path: `${path}[${i}]`, excluded }));
  if (typeof value === 'string') return portableUrl(value, path, excluded);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [name, item] of Object.entries(value)) {
    const location = path ? `${path}.${name}` : name;
    if (isCredentialField(name) || device.has(name) || archives.has(name)) {
      excluded.push({
        path: location,
        reason: isCredentialField(name)
          ? 'credential-device-private'
          : archives.has(name)
            ? 'source-archive-separate'
            : 'device-local',
      });
      continue;
    }
    Object.defineProperty(result, name, {
      value: portableConfiguration(item, { path: location, excluded }),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/** Keep every otherwise-unmapped, non-secret configuration field in a read-only
 * compatibility envelope. It is preserved data, never an implicit Android setting write. */
export function planMigrationMetadata(library, sourceId) {
  const excluded = [],
    coverage = [],
    unmapped = [],
    extra = {};
  for (const [name, value] of Object.entries(library)) {
    if (mapped.has(name)) {
      if (['_sharedSync', '_sharedCommands', '_sharedMedia', '_sharedSeedExports'].includes(name)) {
        excluded.push({ path: name, reason: 'server-private-replication-state' });
        continue;
      }
      if (['chatJournal', 'messageStore', 'revisit'].includes(name))
        domainCoverage(name, value, library, coverage, unmapped, excluded);
      else coverage.push({ path: name, disposition: 'typed-business-adapter' });
      continue;
    }
    if (isCredentialField(name) || device.has(name) || archives.has(name)) {
      excluded.push({
        path: name,
        reason: isCredentialField(name)
          ? 'credential-device-private'
          : archives.has(name)
            ? 'source-archive-separate'
            : 'device-local',
      });
      continue;
    }
    Object.defineProperty(extra, name, {
      value: portableConfiguration(
        name === 'conversationServices' ? serviceRegistry(value, excluded) : value,
        { path: name, excluded },
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    coverage.push({ path: name, disposition: 'preserved-read-only-metadata' });
  }
  const records = [];
  if (Object.keys(extra).length) {
    const record = productRecord('profile', `profile:${sourceId}:migration-metadata`, {
      scope: 'migration-metadata',
      schema: 1,
      sourceId,
      values: extra,
    });
    record.data._product.readOnlyProjection = true;
    records.push(record);
  }
  const report = {
    version: 1,
    fields: coverage,
    excluded,
    unmapped,
    unmappedItemCount: unmapped.reduce((sum, row) => sum + row.count, 0),
    blockers: unmapped.length ? ['UNMAPPED_SOURCE_SUBDOMAINS'] : [],
    verification: 'adapter-plan-only-not-import-or-media-validation',
    credentialFiltering: 'known-configuration-field-names-and-http-url-components-only',
    externalSourcesRequired: [
      'desktop-chat-profile',
      'desktop-notes-workspace',
      'desktop-application-preferences',
    ],
    completeComputerExport: false,
  };
  if (records.length) records[0].data.coverage = structuredClone(report);
  return { records, coverage: report };
}
