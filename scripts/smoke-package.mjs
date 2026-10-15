import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile), source = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run npm run test:package so npm_execpath identifies the npm CLI.');
const root = mkdtempSync(join(tmpdir(), 'human-use-package-'));
const npmRun = async args => JSON.parse((await exec(process.execPath, [npm, ...args, '--json'], { cwd: source, timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout);
const projects = [join(root, '项目 A'), join(root, 'project B')]; let cli;
const run = async args => JSON.parse((await exec(process.execPath, [cli, ...args], { cwd: root, timeout: 20000, windowsHide: true })).stdout);
try {
  const [packed] = await npmRun(['pack', '--ignore-scripts', '--pack-destination', root]);
  const paths = packed.files.map(f => f.path);
  for (const path of paths) assert.ok(!/(^|\/)(data|\.human-use|\.test-data|node_modules|\.git)(\/|$)|api-token$|\.(sqlite|db|zip|log|tgz)$/.test(path), `Private artifact in package: ${path}`);
  for (const path of ['cli.mjs', 'server.mjs', 'public/app.js', 'public/i18n.js', 'lib/service.mjs', 'mcp/server.mjs', 'skills/human-use/SKILL.md', 'skills/human-use-setup/SKILL.md']) assert.ok(paths.includes(path), `Missing: ${path}`);
  const tgz = join(root, packed.filename), prefix = join(root, 'installation with spaces');
  await npmRun(['install', '--global', '--prefix', prefix, tgz, '--ignore-scripts', '--no-audit', '--no-fund']);
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const modules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib/node_modules');
  cli = join(modules, ...pkg.name.split('/'), 'cli.mjs');
  assert.ok(!cli.startsWith(source));
  const shim = process.platform === 'win32' ? join(prefix, 'human-use.cmd') : join(prefix, 'bin/human-use');
  const shimResult = process.platform === 'win32'
    ? await exec('cmd.exe', ['/d', '/s', '/c', `""${shim}" --version"`], { cwd: root, windowsHide: true, windowsVerbatimArguments: true })
    : await exec(shim, ['--version'], { cwd: root });
  assert.equal(shimResult.stdout.trim(), pkg.version);
  const skills = join(root, 'skills'); await run(['setup', 'codex', '--skills-dir', skills]);
  const installedWrapper = join(skills, 'human-use-setup/scripts/cli.mjs');
  for (const project of projects) {
    mkdirSync(project);
    await exec(process.execPath, [installedWrapper, 'init', '--project', project, '--no-open'], { cwd: root, timeout: 20000, windowsHide: true });
  }
  const statuses = await Promise.all(projects.map(project => run(['status', '--project', project])));
  assert.notEqual(statuses[0].url, statuses[1].url);
  const input = join(root, 'request.json'); writeFileSync(input, JSON.stringify({ title: 'Installed package smoke', source: 'package-test', request_key: 'one', description: 'Synthetic', acceptance: 'Answer supplied', units: [{ id: 'reply', label: 'Reply', type: 'text', required: true }] }));
  const created = await run(['api', 'POST', '/api/tickets', input, '--project', projects[0]]);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', projects[1]])).tickets.length, 0);
  const home = await fetch(statuses[0].url), cookie = home.headers.get('set-cookie').split(';')[0]; await home.text();
  const human = async (action, body) => {
    const response = await fetch(`${statuses[0].url}/api/tickets/${created.ticket.id}/${action}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok); return response.json();
  };
  let ticket = await human('draft', { revision: created.ticket.revision, answers: { reply: 'Package works outside checkout' }, note: '' });
  ticket = await human('submit', { revision: ticket.revision });
  const review = join(root, 'review.json'); writeFileSync(review, JSON.stringify({ version: 1, submission_hash: ticket.submissions[0].hash, decision: 'accept', reason: 'Synthetic package workflow verified' }));
  const archived = await run(['api', 'POST', `/api/tickets/${ticket.id}/review`, review, '--project', projects[0]]);
  assert.equal((await run(['api', 'GET', `/api/archives/${archived.archive_hash}`, '--project', projects[0]])).valid, true);
  await run(['stop', '--project', projects[0]]); await run(['start', '--project', projects[0]]);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', projects[0]])).tickets.length, 1);
  const mcp = new Client({ name: 'installed-package-test', version: '1.0.0' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--project', projects[0]], stderr: 'pipe' }));
    assert.equal((await mcp.listTools()).tools.length, 10);
    const result = await mcp.callTool({ name: 'get_ticket', arguments: { ticket_id: ticket.id } });
    assert.equal(JSON.parse(result.content[0].text).archive_hash, archived.archive_hash);
  } finally { await mcp.close(); }
  console.log(`Installed npm package ${pkg.name}@${pkg.version}: CLI shim, skills, two projects, browser API, archive, restart and MCP passed (${paths.length} files).`);
} finally {
  if (cli) for (const project of projects) if (existsSync(join(project, 'human-use.json'))) await run(['stop', '--project', project]);
  rmSync(root, { recursive: true, force: true });
}
