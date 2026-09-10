import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const stages = [
  ['unit', 'test:unit'],
  ['contract', 'test:contract'],
  ['integration', 'test:integration'],
  ['smoke', 'test:smoke'],
  ['e2e', 'test:e2e'],
];
const reportFile = process.env.TEST_REPORT_FILE
  ? resolve(process.env.TEST_REPORT_FILE)
  : resolve(process.cwd(), '../../.ai-workspace/server-next-test-report.json');
const results = [];

for (const [name, script] of stages) {
  const started = performance.now();
  const result = spawnSync('pnpm', [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  results.push({
    name,
    script,
    status: result.status === 0 ? 'passed' : 'failed',
    durationMs: Math.round(performance.now() - started),
    summary: summarize(output),
  });
  if (result.status !== 0) break;
}

const report = {
  project: 'server-next',
  generatedAt: new Date().toISOString(),
  status: results.every((item) => item.status === 'passed')
    ? 'passed'
    : 'failed',
  stages: results,
};
mkdirSync(dirname(reportFile), { recursive: true });
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`server-next test report: ${report.status}`);
for (const item of results)
  console.log(
    `- ${item.name}: ${item.status} (${item.durationMs}ms)${item.summary ? ` — ${item.summary}` : ''}`,
  );
console.log(`report file: ${reportFile}`);
if (report.status === 'failed') process.exitCode = 1;

function summarize(output) {
  const suites = output.match(/Test Suites:.*$/m)?.[0]?.trim();
  const tests = output.match(/Tests:.*$/m)?.[0]?.trim();
  return [suites, tests].filter(Boolean).join('; ');
}
