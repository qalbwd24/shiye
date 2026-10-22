import { auditComputerData } from '../src/server/sync-product/computer-data-inventory.mjs';

const options = new Map([
  ['--diary', 'diary'],
  ['--chat-profile', 'desktop-chat-profile'],
  ['--notes-workspace', 'desktop-notes-workspace'],
  ['--application-preferences', 'desktop-application-preferences'],
]);
const sources = {};
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const kind = options.get(args[i]);
    if (!kind || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    (sources[kind] ||= []).push(args[i + 1]);
  }
  process.stdout.write(`${JSON.stringify(await auditComputerData({ sources }), null, 2)}\n`);
} catch {
  process.stderr.write(
    'AUDIT_FAILED: use --diary, --chat-profile, --notes-workspace, --application-preferences with explicit absolute file paths; repeat flags for multiple files. No files are read by default.\n',
  );
  process.exitCode = 1;
}
