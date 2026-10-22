import {
  loadSourceMessageProof,
  registerSourceMessageConflicts,
} from './source-message-conflicts.mjs';
import path from 'node:path';
import { evaluateCurrentComputerExportCoverage } from './computer-coverage.mjs';
import { readDesktopPreferenceResourceProof } from './desktop-preference-resource-proof.mjs';
import {
  prepareDesktopCollectionCommit,
  commitDesktopCollection,
} from './desktop-collection-commit.mjs';

export function createSourceCollectionRoute({ exportsDir, dataDir, store, body, reply }) {
  if (!path.isAbsolute(exportsDir || '')) throw Error('SOURCE_COLLECTION_EXPLICIT_ROOT_REQUIRED');
  return async (req, res, pathname) => {
    if (
      ![
        '/api/source-collection/messages',
        '/api/source-collection/apply',
        '/api/source-collection/coverage',
        '/api/source-collection/preference-resource-proof',
      ].includes(pathname)
    )
      return false;
    const fail = (status, code) => {
      throw Object.assign(Error(code), { status, code });
    };
    if (req.method !== 'POST') fail(405, 'SOURCE_COLLECTION_METHOD');
    // This route is only reached after app's real-peer/Host/Origin/local-lock
    // checks. A paired/program Bearer never becomes a local issuer credential.
    if (req.headers.authorization || req.headers['x-sync-device-id'])
      fail(403, 'SOURCE_COLLECTION_LOCAL_ADMIN_REQUIRED');
    let input;
    try {
      input = JSON.parse(
        (
          await body(req, pathname.endsWith('/coverage') ? 32 * 1024 * 1024 : 2 * 1024 * 1024)
        ).toString('utf8'),
      );
    } catch (error) {
      if (error.status === 413) throw error;
      fail(400, 'SOURCE_COLLECTION_INVALID');
    }
    if (pathname.endsWith('/coverage')) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).sort().join(',') !== 'manifest,sourceOperationId'
      )
        fail(400, 'SOURCE_COLLECTION_INVALID');
      const coverage = await evaluateCurrentComputerExportCoverage({
        getDb: store.getDb,
        ...input,
      });
      reply(res, 200, coverage);
      return true;
    }
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        (pathname.endsWith('/apply')
          ? 'captureManifestSha256,captureRelativePath,epoch,libraryId,operationId'
          : pathname.endsWith('/preference-resource-proof')
            ? 'captureManifestSha256,captureRelativePath,operationId,request'
            : 'captureManifestSha256,captureRelativePath,operationId,records')
    )
      fail(400, 'SOURCE_COLLECTION_INVALID');
    // A missing actual receipt must fail before reading the private recovery
    // archive. Neither a caller flag nor a dry-run clone is a mapped owner.
    if (
      pathname.endsWith('/preference-resource-proof') &&
      !store
        .getDb()
        .sourceCollections?.receipts?.some(
          (row) => row.operationId === input.operationId && row.status === 'backend-mapped',
        )
    )
      fail(409, 'SOURCE_RESOURCE_RECEIPT_REQUIRED');
    const proof = await loadSourceMessageProof({
      exportsDir,
      relativePath: input.captureRelativePath,
      manifestSha256: input.captureManifestSha256,
    });
    if (pathname.endsWith('/preference-resource-proof')) {
      const result = await readDesktopPreferenceResourceProof({
        getDb: store.getDb,
        dataDir,
        proof,
        operationId: input.operationId,
        request: input.request,
      });
      reply(res, 200, result);
      return true;
    }
    const prepared = pathname.endsWith('/apply')
      ? await prepareDesktopCollectionCommit({ db: store.getDb(), dataDir, proof, ...input })
      : null;
    const result = await store.mutate((db) =>
      prepared
        ? commitDesktopCollection(db, prepared)
        : registerSourceMessageConflicts(db, input, proof),
    );
    reply(res, 200, result);
    return true;
  };
}
