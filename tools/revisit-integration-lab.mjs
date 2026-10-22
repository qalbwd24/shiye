import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runRevisitIntegrationLab } from './lib/revisit-integration-lab.mjs';

const output = path.resolve(import.meta.dirname, '../outputs/revisit-decoupling/stage5');
await fs.mkdir(output, { recursive: true });
const report = await runRevisitIntegrationLab();
await fs.writeFile(path.join(output, 'integration.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `朝花夕拾隔离接入：${report.checks.length}项通过；报告 ${path.join(output, 'integration.json')}`,
);
