import { createRoutes as createRunnerHost } from '../routes/revisit-runner.mjs';
import { createRevisitHttpClient } from '../revisit-runner/client.mjs';
import { registry, activeBinding, scope, scopedContext, serviceScope } from './registry.mjs';

/** Each instance owns one runtime, while all persistence uses the library's existing queue. */
export function createConversationServiceHost(context) {
  const hosts = new Map();
  let closed = false,
    pending,
    again = false,
    lastPort,
    lastCookie = '';
  function host(id) {
    if (!hosts.has(id))
      hosts.set(
        id,
        createRunnerHost({
          ...scopedContext(context, id),
          reply: (res, status, value) =>
            context.reply(res, status, { ...value, scope: serviceScope(context.getDb(), id) }),
          getDb: () => {
            const db = context.getDb(),
              view = scope(db, id);
            return activeBinding(db, id)
              ? view
              : {
                  ...view,
                  revisit: { ...view.revisit, config: { ...view.revisit.config, enabled: false } },
                };
          },
          createClient: (options) => createRevisitHttpClient({ ...options, instanceId: id }),
        }),
      );
    return hosts.get(id);
  }
  function autoStart(port, cookie = '') {
    if (closed) return Promise.resolve();
    lastPort = port;
    lastCookie = cookie;
    if (pending) {
      again = true;
      return pending;
    }
    pending = (async () => {
      do {
        again = false;
        const db = context.getDb();
        for (const [id, value] of hosts)
          if (!activeBinding(db, id)) {
            await value.close();
            hosts.delete(id);
          }
        for (const item of registry(context.getDb()).instances) {
          if (closed) return;
          if (
            item.providerId === 'revisit' &&
            activeBinding(context.getDb(), item.id) &&
            item.state.config.enabled
          )
            await host(item.id).autoStart(lastPort, lastCookie);
        }
      } while (again && !closed);
    })()
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  return {
    host,
    autoStart,
    async close() {
      closed = true;
      await Promise.all([...hosts.values()].map((h) => h.close()));
      await pending;
    },
  };
}
