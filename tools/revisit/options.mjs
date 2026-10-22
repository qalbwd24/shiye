import { localRunnerUrl, runnerError } from '../../src/server/revisit-runner/client.mjs';

export function parseRunnerOptions(args) {
  const values = new Set(['--url', '--interval', '--from', '--to']);
  const flags = new Set(['--help', '--once', '--control', '--password-stdin']);
  const seen = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if ((!values.has(key) && !flags.has(key)) || seen.has(key))
      throw runnerError('invalid_arguments');
    if (values.has(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw runnerError('invalid_arguments');
      seen.set(key, value);
    } else seen.set(key, true);
  }
  if (seen.has('--help')) return { help: true };
  const url = localRunnerUrl(seen.get('--url')).href;
  const intervalSeconds = Number(seen.get('--interval') ?? 30);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3600)
    throw runnerError('invalid_interval');
  const manual = seen.has('--from') || seen.has('--to');
  if (manual && (!seen.has('--from') || !seen.has('--to'))) throw runnerError('invalid_arguments');
  const range = manual ? { manual: true, from: seen.get('--from'), to: seen.get('--to') } : {};
  if (
    manual &&
    (!Number.isFinite(Date.parse(range.from)) ||
      !Number.isFinite(Date.parse(range.to)) ||
      Date.parse(range.from) >= Date.parse(range.to))
  )
    throw runnerError('invalid_arguments');
  const control = seen.has('--control'),
    passwordStdin = seen.has('--password-stdin');
  if (control && (manual || seen.has('--once') || passwordStdin))
    throw runnerError('invalid_arguments');
  return {
    url,
    intervalMs: intervalSeconds * 1000,
    manual,
    range,
    once: manual || seen.has('--once'),
    control,
    passwordStdin,
  };
}
