import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '../skills/human-use/scripts/api.mjs';

test('API client explains local network permission failures and preserves other fetch errors', async t => {
  const root = mkdtempSync(join(tmpdir(), 'human-use-permission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokenFile = join(root, 'api-token');
  const token = 'private-test-token';
  writeFileSync(tokenFile, token);
  const client = createClient({ url: 'http://127.0.0.1:3440', tokenFile });
  let failure;
  t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  for (const code of ['EACCES', 'EPERM']) {
    failure = new TypeError('fetch failed', { cause: Object.assign(new Error('connection denied'), { code }) });
    await assert.rejects(client.json('GET', '/api/info'), error => {
      assert.equal(error.cause, failure);
      assert.ok(error.message.includes(code));
      assert.match(error.message, /127\.0\.0\.1:3440.*sandbox.*approval/);
      assert.ok(!error.message.includes(token));
      return true;
    });
  }
  failure = new TypeError('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) });
  await assert.rejects(client.json('GET', '/api/info'), error => error === failure);
});
