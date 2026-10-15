import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBfcAAAAASUVORK5CYII=', 'base64');
const request = (extra = {}) => ({ title: 'Integration task', source: 'integration', request_key: 'one', description: 'Provide evidence.', acceptance: 'Answer and photo verified.', units: [{ id: 'answer', type: 'text', label: 'Answer', required: true }, { id: 'photo', type: 'attachment', label: 'Screenshot', required: false }], ...extra });
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'human-use-integration-'));
  const app = createApp({ dataDir: root });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const home = await fetch(url); const cookie = home.headers.get('set-cookie').split(';')[0]; await home.text();
  const agent = { Authorization: `Bearer ${app.store.token}` };
  const human = { Cookie: cookie };
  const json = async (path, body, headers = agent) => {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(value)}`); return value;
  };
  const env = { ...process.env, HUMAN_USE_URL: url, HUMAN_USE_TOKEN_FILE: join(root, 'api-token') };
  t.after(async () => { await new Promise(resolve => app.close(resolve)); app.store.close(); rmSync(root, { recursive: true, force: true }); });
  return { ...app, root, url, agent, human, json, env, cookie };
}
function child(script, args, env, input) {
  const process = spawn(globalThis.process.execPath, [script, ...args], { env, cwd: dirname(env.HUMAN_USE_TOKEN_FILE), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  process.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  process.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  if (input !== undefined) process.stdin.end(JSON.stringify(input)); else process.stdin.end();
  const timer = setTimeout(() => process.kill(), 15000); timer.unref();
  const done = once(process, 'close').then(([code]) => { clearTimeout(timer); return { code, stdout, stderr }; });
  return { process, done };
}
function submit(store, ticket) {
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { answer: 'Verified on site.' }, note: '' });
  return store.submit(ticket.id, { revision: ticket.revision });
}

test('committed events, independent read receipts, activity deduplication, rollback and restart', t => {
  const root = mkdtempSync(join(tmpdir(), 'human-use-events-')); let store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const binding = store.bind({ client: 'generic', session_id: 'session-1', cwd: '/project' });
  assert.equal(store.bind({ client: 'generic', session_id: 'session-1', cwd: '/project' }).id, binding.id);
  let observed = 0;
  store.on('activity', e => { observed++; assert.equal(store.cursor(), e.event_id); });
  let ticket = store.create(request({ binding_id: binding.id })).ticket;
  assert.equal(observed, 1); assert.equal(store.readState(ticket.id).unread_count, 1);
  const eventId = store.cursor(); store.markRead(ticket.id, eventId);
  assert.equal(store.get(ticket.id).revision, ticket.revision);
  assert.equal(store.readState(ticket.id).unread_count, 0);
  assert.throws(() => store.transaction(() => { store.create(request({ request_key: 'rolled-back' })); throw new Error('rollback'); }), /rollback/);
  assert.equal(store.cursor(), eventId); assert.equal(observed, 1);
  const activity = { type: 'agent.check_completed', message: 'Actual check result', external_id: 'check-1' };
  const first = store.activity(ticket.id, activity);
  assert.deepEqual(store.activity(ticket.id, activity), first);
  assert.throws(() => store.activity(ticket.id, { ...activity, message: 'different' }), /external_id/);
  ticket = submit(store, ticket);
  const events = store.events({ binding_id: binding.id, audience: 'agent', after: 0 });
  assert.equal(events.events.length, 1); assert.equal(events.events[0].submission_hash, ticket.submissions[0].hash);
  store.close(); store = new Store(root);
  assert.equal(store.readState(ticket.id).unread_count, 1);
  assert.equal(store.events({ binding_id: binding.id, audience: 'agent' }).events[0].event_id, events.cursor);
  assert.deepEqual(store.binding(binding.id), binding);
  store.ackBinding(binding.id, { previous_cursor: binding.cursor, cursor: events.cursor });
  assert.throws(() => store.ackBinding(binding.id, { previous_cursor: binding.cursor, cursor: events.cursor }), /游标/);
});

test('SSE replays after a cursor, respects routing, long-poll wakes and abort cleans listeners', async t => {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const f = await fixture(t);
  const first = f.store.create(request()).ticket;
  const cursor = f.store.cursor();
  const stream = await fetch(`${f.url}/api/events/stream?after=${cursor}&ticket_id=${first.id}`, { headers: f.agent, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
  const reader = stream.body.getReader();
  const firstChunk = new TextDecoder().decode((await reader.read()).value);
  assert.match(firstChunk, /event: ready/);
  const waiting = f.json(`/api/events/wait?after=${cursor}&ticket_id=${first.id}&audience=agent&timeout=2`);
  f.store.create(request({ request_key: 'different-ticket' }));
  const ticket = submit(f.store, first);
  assert.equal((await waiting).events[0].submission_hash, ticket.submissions[0].hash);
  const chunk = new TextDecoder().decode((await reader.read()).value);
  assert.match(chunk, /submission.created/); assert.doesNotMatch(chunk, /different-ticket/);
  f.store.markRead(first.id, cursor);
  f.store.activity(first.id, { type: 'agent.message', message: 'Update after a read receipt', external_id: 'after-read' });
  let subsequent = '';
  while (!subsequent.includes('Update after a read receipt')) subsequent += new TextDecoder().decode((await reader.read()).value);
  assert.match(subsequent, /event: read/);
  assert.match(subsequent, /event: message\nid: \d+\ndata: .*agent.message/);
  controller.abort(); await reader.cancel().catch(error => assert.equal(error.name, 'AbortError'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.store.listenerCount('activity'), 0);
  const replay = await f.json(`/api/events?after=${cursor}&ticket_id=${first.id}`);
  assert.equal(replay.events.length, 2);
  const timeout = await f.json(`/api/events/wait?after=${f.store.cursor()}&timeout=0`);
  assert.equal(timeout.events.length, 0);
});

test('copied Skill script and Bridge use the same API from an unrelated working directory', async t => {
  const f = await fixture(t);
  const copied = join(f.root, 'skill'); cpSync(resolve('skills/human-use'), copied, { recursive: true });
  const input = join(f.root, 'request.json'); writeFileSync(input, JSON.stringify(request()));
  const created = await child(join(copied, 'scripts/api.mjs'), ['POST', '/api/tickets', input], f.env).done;
  assert.equal(created.code, 0, created.stderr);
  const ticket = JSON.parse(created.stdout).ticket;
  const read = await child(resolve('tools/bridge.mjs'), ['GET', `/api/tickets/${ticket.id}`], f.env).done;
  assert.equal(read.code, 0, read.stderr); assert.equal(JSON.parse(read.stdout).id, ticket.id);
  const uploaded = f.store.upload(ticket.id, 'photo', 'sample.png', 'image/png', image, ticket.revision);
  const out = join(f.root, 'original.png');
  const download = await child(join(copied, 'scripts/api.mjs'), ['GET', `/api/tickets/${ticket.id}/attachments/${uploaded.attachments[0].id}`, '--out', out], f.env).done;
  assert.equal(download.code, 0, download.stderr); assert.deepEqual(readFileSync(out), image);
  assert.ok(!created.stdout.includes(f.store.token));
});

test('real SDK stdio MCP creates, waits, reads original images, returns and accepts exact submissions', async t => {
  const f = await fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('mcp/server.mjs')], env: f.env, stderr: 'pipe' });
  const client = new Client({ name: 'human-use-test', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('create_ticket')); assert.ok(!names.some(n => n.includes('submit') || n.includes('draft')));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result)); return result;
  };
  const ticket = JSON.parse((await call('create_ticket', request())).content[0].text).ticket;
  let current = f.store.upload(ticket.id, 'photo', 'photo.png', 'image/png', image, ticket.revision);
  const evidence = await call('read_attachment', { ticket_id: ticket.id, attachment_id: current.attachments[0].id });
  assert.deepEqual(Buffer.from(evidence.content[1].data, 'base64'), image);
  const after = f.store.cursor();
  const pending = call('wait_for_update', { after, ticket_id: ticket.id, timeout: 2 });
  current = submit(f.store, current); assert.equal(JSON.parse((await pending).content[0].text).events[0].type, 'submission.created');
  const submission = current.submissions.at(-1);
  const returned = await call('review_ticket', { ticket_id: ticket.id, version: submission.version, submission_hash: submission.hash, decision: 'return', reason: 'Please clarify observation.', additional_units: [{ id: 'clarification', type: 'text', label: 'Clarification', required: true }] });
  assert.equal(JSON.parse(returned.content[0].text).status, 'returned');
  current = f.store.get(ticket.id);
  assert.equal(current.units.at(-1).id, 'clarification');
  assert.deepEqual(current.submissions[0], submission);
  current = f.store.updateDraft(ticket.id, { revision: current.revision, answers: { ...current.draft.answers, clarification: 'Manual clarification supplied.' }, note: '' });
  current = f.store.submit(ticket.id, { revision: current.revision });
  const stale = await client.callTool({ name: 'review_ticket', arguments: { ticket_id: ticket.id, version: 1, submission_hash: submission.hash, decision: 'accept', reason: 'stale' } });
  assert.equal(stale.isError, true);
  const latest = current.submissions.at(-1);
  const accepted = JSON.parse((await call('review_ticket', { ticket_id: ticket.id, version: latest.version, submission_hash: latest.hash, decision: 'accept', reason: 'Evidence inspected and criteria met.' })).content[0].text);
  const archive = JSON.parse((await call('get_archive', { hash: accepted.archive_hash })).content[0].text);
  assert.equal(archive.valid, true);
});

test('session hooks route context, deduplicate notices, continue once and separate failures from wake signals', async t => {
  const f = await fixture(t);
  const input = { session_id: 'real-session', cwd: f.root, hook_event_name: 'SessionStart' };
  const script = resolve('tools/hook.mjs');
  const invoke = (client, mode, hookInput = input, seconds = 0) => child(script, ['--client', client, '--mode', mode, '--seconds', String(seconds)], f.env, hookInput).done;
  const context = await invoke('codex', 'context'); assert.equal(context.code, 0, context.stderr);
  const binding = f.store.bind({ client: 'codex', session_id: input.session_id, cwd: f.root });
  assert.match(JSON.parse(context.stdout).hookSpecificOutput.additionalContext, new RegExp(binding.id));
  let ticket = f.store.create(request({ binding_id: binding.id })).ticket;
  const stopInput = { ...input, hook_event_name: 'Stop', stop_hook_active: false };
  await invoke('codex', 'notify', { ...input, hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  await invoke('codex', 'notify', { ...input, hook_event_name: 'PostToolUse', tool_name: 'Edit' });
  assert.equal(f.store.events({ ticket_id: ticket.id }).events.filter(e => e.type === 'agent.check_completed').length, 1);
  ticket = submit(f.store, ticket);
  const stop = await invoke('codex', 'stop', stopInput); assert.equal(stop.code, 0, stop.stderr);
  assert.equal(JSON.parse(stop.stdout).decision, 'block'); assert.match(stop.stdout, /submission.created/);
  const second = await invoke('codex', 'stop', stopInput); assert.equal(second.stdout, '');
  const claudeBinding = f.store.bind({ client: 'claude', session_id: input.session_id, cwd: f.root });
  const claudeTicket = f.store.create(request({ request_key: 'claude', binding_id: claudeBinding.id })).ticket;
  submit(f.store, claudeTicket);
  const wake = await invoke('claude', 'watch', stopInput); assert.equal(wake.code, 2); assert.match(wake.stderr, /submission.created/);
  const timeout = await invoke('claude', 'watch', stopInput); assert.equal(timeout.code, 0); assert.equal(timeout.stderr, '');
  const loopGuard = await invoke('codex', 'stop', { ...stopInput, stop_hook_active: true }); assert.equal(loopGuard.stdout, '');
  const malformed = await invoke('claude', 'watch', {}); assert.equal(malformed.code, 1); assert.match(malformed.stderr, /needs session_id/);
});
