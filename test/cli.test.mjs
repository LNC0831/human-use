import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Store } from '../store.mjs';
import { loadProject, locateProject } from '../lib/project.mjs';
import { stopService } from '../lib/service.mjs';

const exec = promisify(execFile);
const cli = resolve('cli.mjs');
const run = async (args, cwd) => JSON.parse((await exec(process.execPath, [cli, ...args], { cwd, timeout: 20000, windowsHide: true })).stdout);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'human-use-cli-'));
  const a = join(root, '项目 A'), b = join(root, 'project B'); mkdirSync(a); mkdirSync(b);
  t.after(async () => {
    for (const path of [a, b]) if (existsSync(join(path, 'human-use.json'))) await stopService(loadProject(path));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, a, b };
}
const request = key => ({ title: 'CLI work order', description: 'Synthetic request', acceptance: 'Read answer', source: 'cli-test', request_key: key, units: [{ id: 'reply', type: 'text', label: 'Reply', required: true }] });

test('project init, concurrent starts, independent cookies and credentials, restart and service identity', { timeout: 60000 }, async t => {
  const { root, a, b } = fixture(t);
  writeFileSync(join(a, 'AGENTS.md'), 'Keep this project discipline.\n');
  writeFileSync(join(a, '.gitignore'), 'existing-rule\n');
  const first = await run(['init', '--project', a, '--no-open', '--no-hooks'], root);
  const repeated = await run(['init', '--project', a, '--no-open', '--no-hooks'], root);
  assert.equal(first.instance_id, repeated.instance_id); assert.equal(repeated.reused, true);
  assert.match(readFileSync(join(a, 'AGENTS.md'), 'utf8'), /^Keep this project discipline/);
  assert.equal(readFileSync(join(a, 'AGENTS.md'), 'utf8').split('# >>> Human Use').length, 2);
  assert.match(readFileSync(join(a, '.gitignore'), 'utf8'), /^existing-rule/);
  assert.ok(!existsSync(join(a, '.codex')));
  // A cloned human-use.json must not make two physical project folders share browser sessions.
  writeFileSync(join(b, 'human-use.json'), readFileSync(join(a, 'human-use.json')));
  const other = await run(['init', '--project', b, '--no-open', '--no-hooks'], root);
  assert.notEqual(first.url, other.url);
  const homeA = await fetch(first.url), cookieA = homeA.headers.get('set-cookie').split(';')[0]; await homeA.text();
  const homeB = await fetch(other.url), cookieB = homeB.headers.get('set-cookie').split(';')[0]; await homeB.text();
  assert.notEqual(cookieA.split('=')[0], cookieB.split('=')[0]);
  assert.equal((await fetch(first.url + '/api/info', { headers: { Cookie: `${cookieA}; ${cookieB}` } })).status, 200);
  assert.equal((await fetch(other.url + '/api/info', { headers: { Cookie: `${cookieA}; ${cookieB}` } })).status, 200);
  assert.equal((await fetch(other.url + '/api/info', { headers: { Authorization: `Bearer ${readFileSync(join(a, '.human-use/api-token'), 'utf8').trim()}` } })).status, 401);
  const body = join(root, 'request.json'); writeFileSync(body, JSON.stringify(request('one')));
  await run(['api', 'POST', '/api/tickets', body, '--project', a], root);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', a], root)).tickets.length, 1);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', b], root)).tickets.length, 0);
  const nested = join(a, 'nested'); mkdirSync(nested); assert.equal(locateProject(nested).id, loadProject(a).id);
  assert.equal((await run(['status'], nested)).instance_id, first.instance_id);
  const runtimeFile = join(a, '.human-use/runtime.json'), runtime = readFileSync(runtimeFile, 'utf8');
  writeFileSync(runtimeFile, JSON.stringify({ ...JSON.parse(runtime), instance_id: 'incorrect-instance' }));
  try { await assert.rejects(run(['stop', '--project', a], root), /Service identity differs/); }
  finally { writeFileSync(runtimeFile, runtime); }
  assert.equal((await run(['status', '--project', a], root)).running, true);
  await run(['stop', '--project', a], root);
  const starts = await Promise.all([run(['start', '--project', a], root), run(['start', '--project', a], root), run(['start', '--project', a], root)]);
  assert.equal(new Set(starts.map(s => s.instance_id)).size, 1);
  assert.notEqual(starts[0].instance_id, first.instance_id);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', a], root)).tickets.length, 1);
  assert.equal((await run(['status', '--project', b], root)).running, true);
});

test('Codex skill setup runs outside package directory; integration preserves unrelated hooks and MCP', { timeout: 60000 }, async t => {
  const { root, a } = fixture(t);
  const skills = join(root, 'user skills');
  const setup = await run(['setup', 'codex', '--skills-dir', skills], root);
  assert.equal(setup.skills.length, 2);
  const wrapper = join(skills, 'human-use-setup/scripts/cli.mjs');
  await exec(process.execPath, [wrapper, 'init', '--project', a, '--no-open'], { cwd: root, timeout: 20000, windowsHide: true });
  await run(['setup', 'codex', '--skills-dir', skills], root);
  const path = join(a, '.codex/hooks.json'), config = JSON.parse(readFileSync(path, 'utf8'));
  config.hooks.SessionStart.unshift({ hooks: [{ type: 'command', command: 'echo existing-hook' }] });
  writeFileSync(path, JSON.stringify(config));
  mkdirSync(join(a, '.codex'), { recursive: true });
  const toml = join(a, '.codex/config.toml'); writeFileSync(toml, 'model = "user-choice"\n[mcp_servers.other]\ncommand = "other"\n');
  await run(['integrate', 'codex', '--mcp', '--project', a], root);
  const first = readFileSync(toml, 'utf8'); await run(['integrate', 'codex', '--mcp', '--project', a], root);
  assert.equal(readFileSync(toml, 'utf8'), first); assert.match(first, /model = "user-choice"/); assert.match(first, /mcp_servers.other/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).hooks.SessionStart.length, 2);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).hooks.SessionStart[0].hooks[0].command, 'echo existing-hook');
  const command = JSON.parse(readFileSync(path, 'utf8')).hooks.SessionStart.at(-1).hooks[0].command;
  const hook = exec(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-EncodedCommand', command.split(' ').at(-1)] : ['-c', command], {
    cwd: a, timeout: 20000, windowsHide: true,
    env: { ...process.env, HUMAN_USE_URL: 'http://127.0.0.1:1', HUMAN_USE_TOKEN_FILE: join(root, 'wrong-token') },
  });
  hook.child.stdin.end(JSON.stringify({ session_id: 'cli-generated-hook', cwd: a, hook_event_name: 'SessionStart' }));
  assert.match(JSON.parse((await hook).stdout).hookSpecificOutput.additionalContext, /Human Use binding_id=/);
  const foreign = join(root, 'foreign/human-use'); mkdirSync(foreign, { recursive: true }); writeFileSync(join(foreign, 'SKILL.md'), 'User-owned skill');
  await assert.rejects(run(['setup', 'codex', '--skills-dir', join(root, 'foreign')], root), /not managed/);
  assert.equal(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), 'User-owned skill');
});

test('explicit migration copies old work orders and frozen hashes, preserves source, rejects overwrite', { timeout: 60000 }, async t => {
  const { root, a } = fixture(t), source = join(root, 'old-data');
  const old = new Store(source);
  let ticket = old.create(request('migration')).ticket;
  ticket = old.updateDraft(ticket.id, { revision: ticket.revision, answers: { reply: 'Synthetic answer' }, note: '' });
  ticket = old.submit(ticket.id, { revision: ticket.revision });
  const submission = ticket.submissions[0];
  const archived = old.review(ticket.id, { version: 1, submission_hash: submission.hash, decision: 'accept', reason: 'Synthetic evidence verified' });
  old.close();
  const result = await run(['migrate', '--from', source, '--project', a], root); assert.equal(result.source_preserved, true);
  assert.ok(existsSync(join(source, 'workorders.sqlite')));
  assert.notEqual(readFileSync(join(source, 'api-token'), 'utf8'), readFileSync(join(a, '.human-use/api-token'), 'utf8'));
  await run(['init', '--project', a, '--no-open', '--no-hooks'], root);
  const info = await run(['api', 'GET', `/api/archives/${archived.archive_hash}`, '--project', a], root);
  assert.equal(info.valid, true);
  await assert.rejects(run(['migrate', '--from', source, '--project', a], root), /not empty/);
  assert.equal((await run(['api', 'GET', '/api/tickets', '--project', a], root)).tickets.length, 1);
});
