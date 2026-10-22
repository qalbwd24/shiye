import { createRevisitHttpClient } from '../../src/server/revisit-runner/client.mjs';
import { createRevisitRunner } from '../../src/server/revisit-runner/runtime.mjs';
import { parseRunnerOptions } from './options.mjs';

const errors = new Set([
  'invalid_url',
  'invalid_arguments',
  'invalid_interval',
  'invalid_password',
  'invalid_session',
  'invalid_response',
  'invalid_request',
  'invalid_command',
  'invalid_input',
  'locked',
  'forbidden',
  'unsupported',
  'rate_limited',
  'server_error',
  'offline',
  'timeout',
  'busy',
  'aborted',
]);
function publicError(error) {
  return {
    code: errors.has(error.code) ? error.code : 'internal_error',
    ...(Number.isInteger(error.status) ? { status: error.status } : {}),
  };
}
async function* lines(input) {
  input.setEncoding('utf8');
  let buffered = '';
  for await (const chunk of input) {
    buffered += chunk;
    let end;
    while ((end = buffered.indexOf('\n')) >= 0) {
      if (end > 4096) throw Object.assign(Error(), { code: 'invalid_input' });
      yield buffered.slice(0, end).replace(/\r$/, '');
      buffered = buffered.slice(end + 1);
    }
    if (buffered.length > 4096) throw Object.assign(Error(), { code: 'invalid_input' });
  }
  if (buffered) yield buffered.replace(/\r$/, '');
}

export async function main(
  args,
  { input = process.stdin, output = process.stdout, errorOutput = process.stderr } = {},
) {
  const write = (value) => output.write(JSON.stringify(value) + '\n');
  let runner,
    keepalive,
    signalDone,
    interrupted = false;
  const handleSignal = () => {
    interrupted = true;
    input.destroy();
    void runner?.stop().finally(() => signalDone?.());
  };
  try {
    const options = parseRunnerOptions(args);
    if (options.help) {
      output.write('朝花夕拾推送：--url http://127.0.0.1:端口 [--once] [--interval 30]\n');
      output.write(
        '手动补看：--from ISO --to ISO --once。认证：--password-stdin（仅内存）。宿主控制：--control（JSON行 start/stop/status/unlock/exit）。\n',
      );
      return 0;
    }
    const client = createRevisitHttpClient({ url: options.url });
    runner = createRevisitRunner({
      client,
      intervalMs: options.intervalMs,
      onStatus: options.once ? () => {} : (status) => write({ kind: 'status', status }),
    });
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    if (options.passwordStdin) {
      let password;
      for await (const line of lines(input)) {
        if (password !== undefined) throw Object.assign(Error(), { code: 'invalid_input' });
        password = line;
      }
      await runner.unlock(password);
      password = undefined;
    }
    if (interrupted) return 0;
    if (options.control) {
      const pending = new Set();
      try {
        for await (const line of lines(input)) {
          if (!line.trim()) continue;
          let command;
          try {
            command = JSON.parse(line);
            if (!command || typeof command !== 'object' || Array.isArray(command))
              throw Error('invalid_input');
          } catch {
            write({ ok: false, error: { code: 'invalid_input' } });
            continue;
          }
          const id =
            typeof command?.id === 'string' && /^[\w.:-]{1,80}$/.test(command.id)
              ? command.id
              : undefined;
          const operation = (async () => {
            try {
              if (!id) throw Object.assign(Error(), { code: 'invalid_command' });
              if (command.action === 'start') runner.start();
              else if (command.action === 'stop' || command.action === 'exit') await runner.stop();
              else if (command.action === 'unlock') await runner.unlock(command.password);
              else if (command.action !== 'status')
                throw Object.assign(Error(), { code: 'invalid_command' });
              write({ id, ok: true, status: runner.status() });
            } catch (error) {
              write({ id, ok: false, error: publicError(error), status: runner.status() });
            }
          })();
          pending.add(operation);
          void operation.finally(() => pending.delete(operation));
          if (command.action === 'exit') {
            await operation;
            break;
          }
        }
      } finally {
        await runner.stop();
        await Promise.allSettled(pending);
      }
    } else if (options.once) {
      write(await runner.runOnce(options.range));
    } else {
      // Keep a locked/unsupported runner available to its host without polling authentication.
      keepalive = setInterval(() => {}, 3600000);
      await new Promise((resolve) => {
        signalDone = resolve;
        runner.start();
      });
    }
    return 0;
  } catch (error) {
    if (interrupted) return 0;
    errorOutput.write(JSON.stringify({ error: publicError(error) }) + '\n');
    return 1;
  } finally {
    clearInterval(keepalive);
    await runner?.stop();
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
  }
}
