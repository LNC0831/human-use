import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';
import { sha256, canonical } from '../archive.mjs';

function request(overrides = {}) {
  return {
    title: '验证设备供电', description: '现场连接设备并反馈结果。', acceptance: '全部检查完成，提供电压与照片。',
    source: 'test-agent', request_key: 'request-1',
    units: [
      { id: 'checks', type: 'checklist', label: '检查连接', required: true, items: [{ id: 'power', label: '电源已连接' }, { id: 'light', label: '检查指示灯' }] },
      { id: 'reply', type: 'text', label: '观察结果', required: true },
      { id: 'voltage', type: 'number', label: '供电电压', required: true, unit: 'V' },
      { id: 'state', type: 'choice', label: '设备状态', required: true, multiple: false, options: [{ id: 'ok', label: '正常' }, { id: 'bad', label: '异常' }] },
      { id: 'photo', type: 'attachment', label: '连接照片', required: true },
    ], ...overrides,
  };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'human-use-test-'));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, root };
}
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBfcAAAAASUVORK5CYII=', 'base64');
function ready(store) {
  let ticket = store.create(request()).ticket;
  ticket = store.upload(ticket.id, 'photo', '接线照片.png', 'image/png', image, ticket.revision);
  return store.updateDraft(ticket.id, { revision: ticket.revision, note: '现场已检查', answers: { checks: ['power','light'], reply: '绿灯常亮', voltage: 5, state: ['ok'], photo: [ticket.attachments[0].id] } });
}
function reviewInput(ticket, decision, reason) {
  return { version: ticket.submissions.at(-1).version, submission_hash: ticket.submissions.at(-1).hash, decision, reason };
}

test('幂等创建、请求契约与草稿版本冲突', t => {
  const { store } = fixture(t);
  const first = store.create(request());
  assert.equal(first.ticket.id, 'TK-000001');
  assert.equal(store.create(request()).created, false);
  assert.throws(() => store.create(request({ title: '不同内容' })), { status: 409 });
  assert.throws(() => store.create(request({ units: [{ type: 'text', label: '缺失 ID', required: true }] })), { status: 400 });
  assert.throws(() => store.create(request({ units: [{ id: '__proto__', type: 'text', label: '非法键', required: true }] })), { status: 400 });
  const saved = store.updateDraft(first.ticket.id, { revision: first.ticket.revision, answers: { voltage: 0 }, note: '' });
  assert.equal(saved.draft.answers.voltage, 0);
  assert.throws(() => store.updateDraft(first.ticket.id, { revision: first.ticket.revision, answers: {}, note: '' }), { status: 409 });
  assert.throws(() => store.submit(saved.id, { revision: saved.revision }), { status: 422 });
});

test('提交、退回、补交与绑定版本的验收，快照和归档保持完整', t => {
  const { store, root } = fixture(t);
  let ticket = ready(store);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  const original = structuredClone(ticket.submissions[0]);
  const { hash, ...snapshot } = original;
  assert.equal(hash, sha256(canonical(snapshot)));
  assert.throws(() => store.updateDraft(ticket.id, { revision: ticket.revision, answers: {}, note: '' }), { status: 409 });
  ticket = store.review(ticket.id, reviewInput(ticket, 'return', '请补充设备型号'));
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { ...ticket.draft.answers, reply: '绿灯常亮，设备型号 A1' }, note: '已补充' });
  assert.deepEqual(ticket.submissions[0], original);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  assert.equal(ticket.submissions.length, 2);
  assert.throws(() => store.review(ticket.id, { version: 1, submission_hash: original.hash, decision: 'accept', reason: '旧版本' }), { status: 409 });
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '全部证据符合验收要求'));
  assert.equal(ticket.status, 'archived');
  assert.match(ticket.archive_hash, /^[0-9a-f]{64}$/);
  const info = store.archiveInfo(ticket.archive_hash);
  assert.equal(info.valid, true);
  assert.equal(info.ticket.archived_at, ticket.updated_at);
  assert.equal(info.file_count, 6);
  assert.ok(existsSync(join(root, 'archives', ticket.archive_hash, 'submissions', '1.json')));
  assert.throws(() => store.cancel(ticket.id, { revision: ticket.revision, reason: '不能取消归档' }), { status: 409 });
  const zip = store.exportArchive(ticket.archive_hash);
  assert.equal(zip.readUInt32LE(), 0x04034b50);
  const end = zip.subarray(zip.length - 22);
  assert.equal(end.readUInt32LE(), 0x06054b50);
  assert.equal(end.readUInt16LE(8), 7);
  assert.equal(end.readUInt32LE(12) + end.readUInt32LE(16), zip.length - 22);
  // 独立按 ZIP 本地头读取所有无压缩条目，检查真实业务文件。
  let offset = 0;
  const files = new Map();
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
    files.set(name, zip.subarray(start, start + size)); offset = start + size;
  }
  assert.equal(sha256(files.get('manifest.json')), ticket.archive_hash);
  assert.deepEqual(files.get(`attachments/${ticket.attachments[0].id}`), image);
  assert.equal(JSON.parse(files.get('reviews.json')).length, 2);
});

test('删除未提交附件，移除历史附件时保留证据与提交哈希', t => {
  const { store, root } = fixture(t);
  let ticket = ready(store);
  const mistaken = ticket.attachments[0].id;
  assert.throws(() => store.removeAttachment(ticket.id, mistaken, { revision: ticket.revision - 1 }), { status: 409 });
  ticket = store.removeAttachment(ticket.id, mistaken, { revision: ticket.revision });
  assert.equal(ticket.attachments.length, 0);
  assert.deepEqual(ticket.draft.answers.photo, []);
  assert.ok(!existsSync(join(root, 'attachments', mistaken)));
  assert.throws(() => store.attachment(ticket.id, mistaken), { status: 404 });
  ticket = store.upload(ticket.id, 'photo', 'evidence.png', 'image/png', image, ticket.revision);
  const evidence = ticket.attachments[0].id;
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  const first = structuredClone(ticket.submissions[0]);
  assert.throws(() => store.removeAttachment(ticket.id, evidence, { revision: ticket.revision }), { status: 409 });
  ticket = store.review(ticket.id, reviewInput(ticket, 'return', '换一张更清晰的照片'));
  ticket = store.removeAttachment(ticket.id, evidence, { revision: ticket.revision });
  assert.deepEqual(ticket.draft.answers.photo, []);
  assert.deepEqual(ticket.submissions[0], first);
  assert.deepEqual(store.attachment(ticket.id, evidence).bytes, image);
  ticket = store.upload(ticket.id, 'photo', 'replacement.png', 'image/png', image, ticket.revision);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '新照片已检查'));
  const folder = join(root, 'archives', ticket.archive_hash);
  assert.ok(!existsSync(join(folder, 'attachments', mistaken)));
  assert.deepEqual(readFileSync(join(folder, 'attachments', evidence)), image);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, 'submissions', '1.json'), 'utf8')), first);
  assert.equal(store.archiveInfo(ticket.archive_hash).valid, true);
});

test('退回可追加新控件，拒绝重复 ID 和验收时追加，历史要求与哈希不变', t => {
  const { store, root } = fixture(t);
  let ticket = ready(store);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  const first = structuredClone(ticket.submissions[0]);
  const additional = [
    { id: 'model', type: 'text', label: '设备型号', required: true },
    { id: 'closeup', type: 'attachment', label: '接口近照', required: true },
  ];
  const returned = { ...reviewInput(ticket, 'return', '补充型号与接口近照'), additional_units: additional };
  assert.throws(() => store.review(ticket.id, { ...returned, additional_units: [{ ...additional[0], id: 'reply' }] }), { status: 400 });
  assert.throws(() => store.review(ticket.id, { ...returned, additional_units: [{ ...additional[0], required: 'yes' }] }), { status: 400 });
  assert.throws(() => store.review(ticket.id, { ...returned, additional_units: [] }), { status: 400 });
  assert.throws(() => store.review(ticket.id, { ...returned, decision: 'accept' }), { status: 400 });
  assert.equal(store.get(ticket.id).status, 'submitted');
  ticket = store.review(ticket.id, returned);
  assert.equal(ticket.units.length, first.units.length + 2);
  assert.deepEqual(ticket.reviews[0].additional_units, additional);
  assert.deepEqual(ticket.submissions[0], first);
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 422 });
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { ...ticket.draft.answers, model: 'A1' }, note: '补充型号' });
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 422 });
  ticket = store.upload(ticket.id, 'closeup', 'closeup.png', 'image/png', image, ticket.revision);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  assert.deepEqual(ticket.submissions[1].units, ticket.units);
  const { hash, ...body } = ticket.submissions[1];
  assert.equal(hash, sha256(canonical(body)));
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '补充证据已检查'));
  const archived = JSON.parse(readFileSync(join(root, 'archives', ticket.archive_hash, 'submissions', '1.json'), 'utf8'));
  assert.deepEqual(archived, first);
  assert.equal(store.archiveInfo(ticket.archive_hash).valid, true);
});

test('已有无 units 的旧版提交在追加控件及归档后维持原哈希', t => {
  const { store, root } = fixture(t);
  let ticket = ready(store);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  const { units, hash, ...legacyBody } = ticket.submissions[0];
  const legacy = { ...legacyBody, hash: sha256(canonical(legacyBody)) };
  ticket.submissions[0] = legacy;
  // Reproduce an existing v0.3 snapshot without changing the production migration path.
  store.db.prepare('UPDATE tickets SET document = ? WHERE seq = ?').run(JSON.stringify(ticket), Number(ticket.id.slice(3)));
  ticket = store.review(ticket.id, { ...reviewInput(ticket, 'return', '补充说明'), additional_units: [{ id: 'extra', type: 'text', label: '补充项', required: false }] });
  assert.deepEqual(ticket.submissions[0], legacy);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  assert.equal(ticket.submissions[1].units.length, units.length + 1);
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '已检查原提交与补充要求'));
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'archives', ticket.archive_hash, 'submissions', '1.json'), 'utf8')), legacy);
  assert.equal(store.archiveInfo(ticket.archive_hash).valid, true);
});

test('时间戳支持手动保存、必填检查和按版本归档，拒绝无效日期', t => {
  const { store, root } = fixture(t);
  let ticket = store.create(request({ units: [
    { id: 'operated_at', type: 'timestamp', label: '操作时间', required: true },
    { id: 'optional_time', type: 'timestamp', label: '可选时间', required: false },
  ] })).ticket;
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 422 });
  for (const value of [null, 123, 'not-a-date', '2026-10-15T18:30:00', '2026-02-30T10:30:00.000Z']) {
    assert.throws(() => store.updateDraft(ticket.id, { revision: ticket.revision, answers: { operated_at: value }, note: '' }), { status: 400 });
  }
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { operated_at: '', optional_time: '' }, note: '' });
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 422 });
  const manual = '2026-10-15T10:30:00.000Z';
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { operated_at: manual, optional_time: '' }, note: '手动记录' });
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  const original = structuredClone(ticket.submissions[0]);
  assert.equal(original.answers.operated_at, manual);
  ticket = store.review(ticket.id, reviewInput(ticket, 'return', '校正操作时间'));
  ticket = store.updateDraft(ticket.id, { revision: ticket.revision, answers: { operated_at: '2026-10-15T11:30:00.000Z', optional_time: '' }, note: '已校正' });
  assert.deepEqual(ticket.submissions[0], original);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '时间记录已检查'));
  const folder = join(root, 'archives', ticket.archive_hash, 'submissions');
  assert.equal(JSON.parse(readFileSync(join(folder, '1.json'), 'utf8')).answers.operated_at, manual);
  assert.equal(JSON.parse(readFileSync(join(folder, '2.json'), 'utf8')).answers.operated_at, '2026-10-15T11:30:00.000Z');
  assert.equal(store.archiveInfo(ticket.archive_hash).valid, true);
});

test('附件归属、原始证据被修改与归档包篡改均明确失败', t => {
  const { store, root } = fixture(t);
  let ticket = ready(store);
  assert.throws(() => store.updateDraft(ticket.id, { revision: ticket.revision, note: '', answers: { photo: ['other-ticket-file'] } }), { status: 400 });
  const attachmentPath = join(root, 'attachments', ticket.attachments[0].id);
  writeFileSync(attachmentPath, 'tampered');
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 409 });
  writeFileSync(attachmentPath, image);
  ticket = store.submit(ticket.id, { revision: ticket.revision });
  ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '符合要求'));
  writeFileSync(join(root, 'archives', ticket.archive_hash, 'attachments', ticket.attachments[0].id), 'changed');
  assert.equal(store.archiveInfo(ticket.archive_hash).valid, false);
  assert.throws(() => store.exportArchive(ticket.archive_hash), { status: 409 });
});

test('无法完成不要求填满表单，恢复与取消保留事件', t => {
  const { store } = fixture(t);
  let ticket = store.create(request()).ticket;
  ticket = store.block(ticket.id, { revision: ticket.revision, reason: '缺少测量工具' });
  assert.equal(ticket.status, 'blocked');
  assert.equal(store.list({ status: 'blocked', source: 'test-agent' }).length, 1);
  ticket = store.resume(ticket.id, { revision: ticket.revision });
  assert.equal(ticket.status, 'pending');
  ticket = store.cancel(ticket.id, { revision: ticket.revision, reason: '现场任务取消' });
  assert.equal(ticket.events.at(-1).reason, '现场任务取消');
  assert.throws(() => store.submit(ticket.id, { revision: ticket.revision }), { status: 409 });
});

test('关闭并重新打开 SQLite 后，凭证、草稿及归档仍可读取', () => {
  const root = mkdtempSync(join(tmpdir(), 'human-use-restart-'));
  let store = new Store(root);
  const token = store.token;
  let ticket;
  try {
    ticket = ready(store);
    ticket = store.submit(ticket.id, { revision: ticket.revision });
    ticket = store.review(ticket.id, reviewInput(ticket, 'accept', '验收通过'));
  } finally { store.close(); }
  store = new Store(root);
  try {
    assert.equal(store.token, token);
    assert.deepEqual(store.get(ticket.id), ticket);
    assert.equal(store.archiveInfo(ticket.archive_hash).valid, true);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('HTTP 访问边界、表单上传、验收与 ZIP 导出可实际调用', async t => {
  const root = mkdtempSync(join(tmpdir(), 'human-use-http-'));
  const { server, store } = createApp({ dataDir: root });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Human Use/);
  assert.equal((await fetch(base + '/api/tickets')).status, 401);
  const agentHeaders = { Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json' };
  const humanHeaders = { Cookie: cookie, 'Content-Type': 'application/json', Origin: base };
  const call = (path, body, headers = humanHeaders) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/tickets', { headers: { ...agentHeaders, Origin: 'https://untrusted.example' } })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(base + '/api/tickets', { headers: { ...agentHeaders, Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await fetch(base + '/api/tickets', { headers: { ...agentHeaders, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('/api/tickets', request(), humanHeaders)).status, 403);
  assert.equal((await call('/api/tickets', { padding: 'x'.repeat(1024 * 1024) }, agentHeaders)).status, 413);
  const created = await call('/api/tickets', request(), agentHeaders);
  assert.equal(created.status, 201);
  let { ticket } = await created.json();
  const removedUpload = await fetch(base + `/api/tickets/${ticket.id}/attachments?` + new URLSearchParams({ unit_id: 'photo', name: 'mistake.png', revision: ticket.revision }), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: image });
  ticket = await removedUpload.json();
  const mistakenId = ticket.attachments[0].id;
  const removePath = `/api/tickets/${ticket.id}/attachments/${mistakenId}/remove`;
  assert.equal((await call(removePath, { revision: ticket.revision }, agentHeaders)).status, 403);
  assert.equal((await call(removePath, { revision: ticket.revision - 1 })).status, 409);
  ticket = await (await call(removePath, { revision: ticket.revision })).json();
  assert.equal(ticket.attachments.length, 0);
  assert.equal((await fetch(base + `/api/tickets/${ticket.id}/attachments/${mistakenId}`, { headers: agentHeaders })).status, 404);
  assert.equal((await call(`/api/tickets/${ticket.id}/submit`, { revision: ticket.revision })).status, 422);
  const upload = await fetch(base + `/api/tickets/${ticket.id}/attachments?` + new URLSearchParams({ unit_id: 'photo', name: '接线.png', revision: ticket.revision }), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: image });
  assert.equal(upload.status, 201); ticket = await upload.json();
  const attachmentId = ticket.attachments[0].id;
  const attachment = await fetch(base + `/api/tickets/${ticket.id}/attachments/${attachmentId}`, { headers: agentHeaders });
  assert.equal(attachment.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), image);
  ticket = await (await call(`/api/tickets/${ticket.id}/draft`, { revision: ticket.revision, answers: { checks: ['power','light'], reply: '正常', voltage: 5.1, state: ['ok'], photo: [attachmentId] }, note: '' })).json();
  ticket = await (await call(`/api/tickets/${ticket.id}/submit`, { revision: ticket.revision })).json();
  assert.equal((await call(`/api/tickets/${ticket.id}/review`, reviewInput(ticket, 'accept', '满足要求'))).status, 403);
  ticket = await (await call(`/api/tickets/${ticket.id}/review`, reviewInput(ticket, 'accept', '满足要求'), agentHeaders)).json();
  assert.equal(ticket.status, 'archived');
  const archive = await fetch(base + `/api/archives/${ticket.archive_hash}`, { headers: agentHeaders });
  assert.equal((await archive.json()).valid, true);
  const zip = await fetch(base + `/api/archives/${ticket.archive_hash}/download`, { headers: { Cookie: cookie } });
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.ok((await zip.arrayBuffer()).byteLength > 0);
  assert.equal(readFileSync(join(root, 'api-token'), 'utf8'), store.token);
});
