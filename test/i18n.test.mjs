import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { languages, messages, selectLanguage, translate } from '../public/i18n.js';
import { createApp } from '../server.mjs';

test('browser language preferences and translated parameters preserve user text', () => {
  for (const [preferences, expected] of [
    [['zh-Hans-CN', 'en'], 'zh-CN'], [['zh-Hans-HK'], 'zh-CN'], [['zh-Hant'], 'zh-TW'],
    [['zh-HK'], 'zh-TW'], [['zh-MO'], 'zh-TW'], [['en-GB', 'zh-TW'], 'en'],
    [['fr', 'zh-TW'], 'zh-TW'], [['fr'], 'en'], [[], 'en'],
  ]) assert.equal(selectLanguage(preferences), expected);
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, variants] of Object.entries(messages)) {
    for (const variant of variants) assert.deepEqual(placeholders(variant), placeholders(key), key);
  }
  assert.equal(translate('en', '请完成必填项：{label}', { label: '实测电压 {V}' }), 'Complete the required field: 实测电压 {V}');
  assert.equal(translate('zh-TW', '第 {count} 次提交', { count: 2 }), '第 2 次提交');
});

test('HTTP UI assets, validation and archive verification support three languages without changing records', async t => {
  const root = mkdtempSync(join(tmpdir(), 'human-use-language-'));
  const app = createApp({ dataDir: root });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => {
    await new Promise(resolve => app.close(resolve)); app.store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const home = await fetch(base), cookie = home.headers.get('set-cookie').split(';')[0];
  assert.match(await home.text(), /src="\/app.js" type="module"/);
  const module = await fetch(base + '/i18n.js');
  assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /javascript/);
  await module.text();
  let ticket = app.store.create({
    title: '保留原文', source: 'locale-test', request_key: 'one', description: '现场观察', acceptance: '如实回答',
    units: [{ id: 'reply', type: 'text', label: '观察结果 {test}', required: true }],
  }).ticket;
  const human = (action, body, language) => fetch(`${base}/api/tickets/${ticket.id}/${action}`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(language ? { 'Accept-Language': language } : {}) }, body: JSON.stringify(body),
  });
  for (const language of languages) {
    const response = await human('submit', { revision: ticket.revision }, language);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, translate(language, '请完成必填项：{label}', { label: '观察结果 {test}' }));
  }
  const fallback = await human('submit', { revision: ticket.revision });
  assert.equal((await fallback.json()).error, '请完成必填项：观察结果 {test}');
  const invalid = await human('draft', { revision: ticket.revision, answers: { reply: 12 }, note: '' }, 'en');
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, '观察结果 {test} requires text');
  ticket = app.store.updateDraft(ticket.id, { revision: ticket.revision, answers: { reply: '原文回答' }, note: '原文备注' });
  ticket = app.store.submit(ticket.id, { revision: ticket.revision });
  ticket = app.store.review(ticket.id, { version: 1, submission_hash: ticket.submissions[0].hash, decision: 'accept', reason: '符合要求' });
  const before = app.store.get(ticket.id), zip = app.store.exportArchive(ticket.archive_hash);
  for (const language of languages) {
    const response = await fetch(`${base}/api/archives/${ticket.archive_hash}`, { headers: { Cookie: cookie, 'Accept-Language': language } });
    const result = await response.json();
    assert.equal(result.valid, true); assert.equal(result.ticket.title, '保留原文');
    assert.deepEqual(app.store.exportArchive(ticket.archive_hash, language), zip);
  }
  assert.deepEqual(app.store.get(ticket.id), before);
  writeFileSync(join(root, 'archives', ticket.archive_hash, 'reviews.json'), '[]');
  for (const language of languages) {
    const response = await fetch(`${base}/api/archives/${ticket.archive_hash}/verify`, { headers: { Cookie: cookie, 'Accept-Language': language } });
    const result = await response.json();
    assert.equal(result.valid, false); assert.equal(result.ticket, null);
    assert.deepEqual(result.errors, [translate(language, '文件内容不符：{path}', { path: 'reviews.json' })]);
  }
});
