import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [method, path, ...args] = process.argv.slice(2);
if (!['GET', 'POST'].includes(method) || !path?.startsWith('/api/')) {
  console.error('用法：node tools/bridge.mjs GET /api/tickets');
  console.error('      node tools/bridge.mjs POST /api/tickets examples/ticket.json');
  console.error('      node tools/bridge.mjs GET /api/archives/{hash}/download --out package.zip');
  process.exit(1);
}
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
if (outIndex >= 0 && !outPath) throw new Error('--out 后需要指定文件路径');
const inputPath = args[0] && args[0] !== '--out' ? args[0] : null;
const root = resolve(process.env.WORKORDER_DATA_DIR || 'data');
const token = readFileSync(join(root, 'api-token'), 'utf8').trim();
const headers = { Authorization: `Bearer ${token}` };
let body;
if (inputPath) {
  body = JSON.stringify(JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')));
  headers['Content-Type'] = 'application/json';
}
const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4317}${path}`, { method, headers, body });
if (!response.ok) {
  const error = await response.json();
  console.error(`${response.status} ${error.error}`);
  process.exitCode = 1;
} else if (outPath) {
  writeFileSync(resolve(outPath), Buffer.from(await response.arrayBuffer()));
  console.log(`已保存：${resolve(outPath)}`);
} else if (response.headers.get('content-type')?.startsWith('application/json')) {
  console.log(JSON.stringify(await response.json(), null, 2));
} else {
  console.error('这是二进制附件或工单包。请使用 --out 指定保存路径。');
  process.exitCode = 1;
}
