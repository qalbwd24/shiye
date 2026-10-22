import { randomUUID } from 'node:crypto';
import { createBackendProgramClient } from './program-client.mjs';

/** Explicit one-step backend fixture, no UI, timer, installer, script spawning or
 * model invocation. The same operationId can be retried after a lost response. */
export async function runSyntheticProgramStep({
  baseUrl,
  token,
  operationId = randomUUID(),
  fetchImpl = fetch,
}) {
  let requests = 0;
  const client = createBackendProgramClient({
    baseUrl,
    token,
    fetchImpl,
    onRequest: () => {
      if (++requests > 8) throw Error('PROGRAM_WORKER_REQUEST_LIMIT');
    },
  });
  try {
    const info = await client.info();
    if (info.kind === 'ai')
      return { executed: false, reason: 'AI_PROVIDER_NOT_EXECUTED', requests };
    const text = info.config?.parameters?.syntheticReply;
    if (typeof text !== 'string' || !text || text.length > 2000)
      throw Error('PROGRAM_SYNTHETIC_REPLY_NOT_CONFIGURED');
    const feed = await client.feed({ limit: 20 });
    const target = feed.messages.find(
      (message) => message.state === 'active' && message.actor?.kind === 'self',
    );
    if (!target) return { executed: false, reason: 'NO_VISIBLE_SELF_MESSAGE', requests };
    const reply = await client.send({
      operationId,
      kind: 'message',
      text,
      replyToMessageId: target.id,
    });
    return {
      executed: true,
      operationId,
      instanceId: info.instanceId,
      actorId: info.actorId,
      reply,
      requests,
    };
  } finally {
    client.dispose();
  }
}
