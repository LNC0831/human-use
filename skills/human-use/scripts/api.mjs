import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createClient({ defaultDataDir } = {}) {
  const base = new URL(process.env.HUMAN_USE_URL || `http://127.0.0.1:${process.env.PORT || 4317}`);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.pathname !== '/') {
    throw new Error('HUMAN_USE_URL must be a loopback HTTP origin, e.g. http://127.0.0.1:4317');
  }
  const dataDir = process.env.WORKORDER_DATA_DIR || defaultDataDir;
  const tokenFile = process.env.HUMAN_USE_TOKEN_FILE || (dataDir && join(dataDir, 'api-token'));
  if (!tokenFile) throw new Error('Set HUMAN_USE_TOKEN_FILE to the absolute path of the running service’s data/api-token file.');
  const token = readFileSync(resolve(tokenFile), 'utf8').trim();
  async function request(method, path, body, { signal } = {}) {
    if (!path.startsWith('/api/') || path.includes('\\')) throw new Error('Use an /api/ path.');
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) throw new Error('Use a local /api/ path.');
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`${response.status} ${error.error}`);
    }
    return response;
  }
  const json = async (method, path, body, options) => (await request(method, path, body, options)).json();
  return { request, json, base: base.origin };
}

export async function main(args = process.argv.slice(2), options) {
  const [method, path, ...rest] = args;
  if (!['GET', 'POST'].includes(method) || !path?.startsWith('/api/')) throw new Error('Usage: node api.mjs GET /api/tickets | POST /api/tickets request.json | GET /api/... --out evidence.png');
  const outIndex = rest.indexOf('--out');
  const outPath = outIndex >= 0 ? rest[outIndex + 1] : null;
  if (outIndex >= 0 && !outPath) throw new Error('--out requires a filename');
  const inputPath = rest[0] && rest[0] !== '--out' ? rest[0] : null;
  const body = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '')) : undefined;
  const response = await createClient(options).request(method, path, body);
  if (outPath) {
    writeFileSync(resolve(outPath), Buffer.from(await response.arrayBuffer()));
    console.log(`Saved: ${resolve(outPath)}`);
  } else if (response.headers.get('content-type')?.startsWith('application/json')) console.log(JSON.stringify(await response.json(), null, 2));
  else throw new Error('Binary response: use --out to save the original evidence or ZIP.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
