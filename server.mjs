import { createServer } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Store, HttpError, requireCondition } from './store.mjs';
import { loadProject } from './lib/project.mjs';
import { version } from './lib/version.mjs';

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
export const MAX_UPLOAD = 20 * 1024 * 1024;
const previewTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

async function readBody(request, limit) {
  let length = 0;
  const chunks = [];
  // 在读取阶段限制长度，不能只相信 Content-Length。
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw new HttpError(413, `请求超过 ${Math.floor(limit / 1024 / 1024)} MiB 上限`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(request) {
  requireCondition(request.headers['content-type']?.split(';')[0] === 'application/json', '需要 application/json', 415);
  const bytes = await readBody(request, 1024 * 1024);
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) throw new HttpError(400, 'JSON 格式无效'); throw error; }
  requireCondition(body !== null && typeof body === 'object' && !Array.isArray(body), '需要 JSON 对象');
  return body;
}

export function createApp({ dataDir = resolve(process.env.WORKORDER_DATA_DIR || 'data'), project = null, instanceId = null, onStop } = {}) {
  const store = new Store(dataDir);
  const session = createHmac('sha256', store.token).update('human-use.browser-session.v1').digest('hex');
  const cookieName = project ? `human_use_${session.slice(0, 16)}` : 'workorder_session';
  const streams = new Set();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    try {
      const port = server.address().port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      const host = request.headers.host;
      requireCondition(allowedHosts.has(host), '不允许的 Host', 403);
      requireCondition(!request.headers.origin || request.headers.origin === `http://${host}`, '不允许跨域请求', 403);
      requireCondition(!['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']), '不允许跨站请求', 403);
      const url = new URL(request.url, `http://${host}`), path = url.pathname, method = request.method;
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      if (method === 'GET' && assets[path]) {
        if (path === '/') response.setHeader('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        return send(200, readFileSync(join(publicRoot, assets[path][0])), assets[path][1]);
      }
      const bearer = request.headers.authorization === `Bearer ${store.token}`;
      const cookies = (request.headers.cookie || '').split(';').map(c => c.trim());
      const human = cookies.includes(`${cookieName}=${session}`);
      requireCondition(bearer || human, '需要本机 API Bearer token 或网页会话', 401);
      const agentOnly = () => requireCondition(bearer, '验收和取消需要 AI 接口凭证', 403);
      const humanOnly = () => requireCondition(human, '人工操作请使用本机网页会话', 403);
      if (method === 'GET' && path === '/api/info') return send(200, { name: 'Human Use', version, access: 'loopback', max_upload_bytes: MAX_UPLOAD, event_cursor: store.cursor(),
        project: project ? { id: project.id, name: project.name, root: project.root } : null, instance_id: instanceId });
      if (method === 'POST' && path === '/api/service/stop') {
        agentOnly(); requireCondition(onStop && instanceId, 'This service is not CLI-managed', 409);
        requireCondition((await jsonBody(request)).instance_id === instanceId, 'Service instance changed', 409);
        send(200, { stopping: true }); setImmediate(onStop); return;
      }
      if (method === 'GET' && ['/api/events', '/api/events/wait', '/api/events/stream'].includes(path)) {
        const query = Object.fromEntries(url.searchParams);
        if (request.headers['last-event-id']) query.after = request.headers['last-event-id'];
        let result = store.events(query);
        if (path === '/api/events') return send(200, result);
        if (path === '/api/events/wait') {
          const seconds = Number(query.timeout ?? 25);
          requireCondition(Number.isFinite(seconds) && seconds >= 0 && seconds <= 25, '等待时间需要 0–25 秒');
          if (result.events.length || !seconds) return send(200, result);
          const finish = () => { cleanup(); if (!response.destroyed) send(200, store.events(query)); };
          const changed = () => { if (store.events(query).events.length) finish(); };
          const timer = setTimeout(finish, seconds * 1000);
          const cleanup = () => { clearTimeout(timer); store.off('activity', changed); response.off('close', cleanup); };
          store.on('activity', changed); response.on('close', cleanup);
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        response.flushHeaders();
        let cursor = Number(query.after || 0);
        const flush = () => {
          do {
            result = store.events({ ...query, after: cursor });
            for (const event of result.events) { response.write(`event: message\nid: ${event.event_id}\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.event_id; }
          } while (result.events.length === Number(query.limit || 100));
        };
        store.on('activity', flush); streams.add(response);
        const receipt = data => {
          if (query.ticket_id && query.ticket_id !== data.ticket_id) return;
          if (query.binding_id && store.get(data.ticket_id).binding_id !== query.binding_id) return;
          response.write(`event: read\ndata: ${JSON.stringify(data)}\n\n`);
        };
        store.on('read', receipt);
        response.write('event: ready\ndata: {}\n\n'); flush();
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000); heartbeat.unref();
        response.on('close', () => { clearInterval(heartbeat); store.off('activity', flush); store.off('read', receipt); streams.delete(response); });
        return;
      }
      if (method === 'POST' && path === '/api/bindings') { agentOnly(); return send(200, store.bind(await jsonBody(request))); }
      const bindingMatch = /^\/api\/bindings\/([a-f0-9-]+)(?:\/(ack|lease))?$/.exec(path);
      if (bindingMatch) {
        agentOnly(); const [, id, action] = bindingMatch;
        if (method === 'GET' && !action) return send(200, store.binding(id));
        if (method === 'POST' && action) return send(200, store[action === 'ack' ? 'ackBinding' : 'leaseBinding'](id, await jsonBody(request)));
      }
      if (method === 'GET' && path === '/api/tickets') return send(200, { tickets: store.list(Object.fromEntries(url.searchParams)) });
      if (method === 'POST' && path === '/api/tickets') {
        agentOnly();
        const result = store.create(await jsonBody(request));
        return send(result.created ? 201 : 200, { ...result, url: `http://127.0.0.1:${port}/#ticket/${result.ticket.id}` });
      }
      if (method === 'POST' && path === '/api/demo') {
        humanOnly();
        const result = store.create({
          title: '确认设备连接与供电', source: '入门示例', request_key: randomBytes(12).toString('hex'),
          description: 'AI 需要你在现场确认设备状态。按下面的步骤完成操作，并提供测量结果与照片。此示例只演示协作流程，请根据实际设备操作。',
          acceptance: '操作项全部完成；填写实际供电电压；说明设备状态；上传一张清晰的连接照片。AI 读取结果后提交验收。',
          units: [
            { id: 'setup', type: 'checklist', label: '完成连接检查', required: true, items: [{ id: 'cable', label: '检查电源线与数据线连接牢固' }, { id: 'indicator', label: '观察设备指示灯状态' }] },
            { id: 'voltage', type: 'number', label: '记录实测供电电压', required: true, unit: 'V' },
            { id: 'state', type: 'choice', label: '设备当前状态', required: true, multiple: false, options: [{ id: 'normal', label: '运行正常' }, { id: 'abnormal', label: '存在异常' }] },
            { id: 'observation', type: 'text', label: '描述观察结果', required: true, description: '说明指示灯状态、运行现象或异常信息。' },
            { id: 'photo', type: 'attachment', label: '上传连接照片', required: true, description: '上传一张能看清电源和接口连接的照片，也可添加相关日志。' },
          ],
        });
        return send(201, result);
      }
      const ticketMatch = /^\/api\/tickets\/(TK-\d{6,})(?:\/(draft|submit|block|resume|review|cancel|attachments|read|activity))?$/.exec(path);
      if (ticketMatch) {
        const [, id, action] = ticketMatch;
        if (method === 'GET' && !action) return send(200, store.view(id));
        if (method === 'POST' && action === 'read') { humanOnly(); return send(200, store.markRead(id, (await jsonBody(request)).event_id)); }
        if (method === 'POST' && action === 'activity') { agentOnly(); return send(201, store.activity(id, await jsonBody(request))); }
        if (method === 'POST' && action === 'attachments') {
          humanOnly();
          const bytes = await readBody(request, MAX_UPLOAD);
          return send(201, store.upload(id, url.searchParams.get('unit_id'), url.searchParams.get('name'), request.headers['content-type'] || 'application/octet-stream', bytes, Number(url.searchParams.get('revision'))));
        }
        if (method === 'POST' && ['draft', 'submit', 'block', 'resume', 'review', 'cancel'].includes(action)) {
          if (['review', 'cancel'].includes(action)) agentOnly(); else humanOnly();
          const body = await jsonBody(request);
          const operation = action === 'draft' ? 'updateDraft' : action;
          return send(200, store[operation](id, body));
        }
      }
      const attachmentMatch = /^\/api\/tickets\/(TK-\d{6,})\/attachments\/([a-f0-9-]+)(\/remove)?$/.exec(path);
      if (method === 'POST' && attachmentMatch?.[3]) {
        humanOnly();
        return send(200, store.removeAttachment(attachmentMatch[1], attachmentMatch[2], await jsonBody(request)));
      }
      if (method === 'GET' && attachmentMatch && !attachmentMatch[3]) {
        const { metadata, bytes } = store.attachment(attachmentMatch[1], attachmentMatch[2]);
        const preview = previewTypes.has(metadata.mime) && url.searchParams.get('download') !== '1';
        response.setHeader('Content-Disposition', `${preview ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(metadata.name).replace(/'/g, '%27')}`);
        return send(200, bytes, preview ? metadata.mime : 'application/octet-stream');
      }
      const archiveMatch = /^\/api\/archives\/([a-f0-9]{64})(?:\/(verify|download))?$/.exec(path);
      if (archiveMatch) {
        const [, hash, action] = archiveMatch;
        if (method === 'GET' && (!action || action === 'verify')) return send(200, store.archiveInfo(hash));
        if (method === 'GET' && action === 'download') {
          const bytes = store.exportArchive(hash);
          response.setHeader('Content-Disposition', `attachment; filename="${hash}.zip"`);
          return send(200, bytes, 'application/zip');
        }
      }
      throw new HttpError(404, '接口不存在');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      if (!response.headersSent && !response.destroyed) send(error.status || 500, { error: error instanceof HttpError ? error.message : '本机服务发生错误，请查看终端日志' });
    }
  });
  const close = callback => { for (const stream of streams) stream.end(); server.close(callback); server.closeAllConnections(); };
  return { server, store, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  const project = process.env.HUMAN_USE_PROJECT ? loadProject(process.env.HUMAN_USE_PROJECT) : null;
  const instanceId = project ? process.env.HUMAN_USE_INSTANCE : null;
  const runtime = project && join(project.dataDir, 'runtime.json');
  const stop = () => close(() => {
    store.close();
    if (runtime && existsSync(runtime) && JSON.parse(readFileSync(runtime, 'utf8')).instance_id === instanceId) unlinkSync(runtime);
    process.exit(0);
  });
  const { server, store, close } = createApp({ ...(project ? { dataDir: project.dataDir } : {}), project, instanceId, onStop: project ? stop : undefined });
  server.listen(port, '127.0.0.1', () => {
    if (project) {
      const temp = `${runtime}.${instanceId}.tmp`;
      writeFileSync(temp, JSON.stringify({ project_id: project.id, instance_id: instanceId, url: `http://127.0.0.1:${server.address().port}`, pid: process.pid, version }, null, 2) + '\n', { mode: 0o600 });
      renameSync(temp, runtime);
    }
    console.log(`Human Use 已启动：http://127.0.0.1:${server.address().port}`);
    console.log(`本地数据目录：${store.root}`);
    console.log(`API 凭证文件：${join(store.root, 'api-token')}（请勿公开）`);
    if (process.send) process.send({ type: 'ready' });
  });
  server.on('error', error => { console.error(error); process.exitCode = 1; store.close(); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
