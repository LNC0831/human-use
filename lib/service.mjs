import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '../skills/human-use/scripts/api.mjs';
import { version } from './version.mjs';

export const runtimePath = project => join(project.dataDir, 'runtime.json');
export function serviceClient(project, runtime) {
  return createClient({ url: runtime.url, tokenFile: join(project.dataDir, 'api-token') });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function serviceStatus(project) {
  if (!existsSync(runtimePath(project))) return { running: false, project: project.root, data_dir: project.dataDir };
  const runtime = JSON.parse(readFileSync(runtimePath(project), 'utf8'));
  if (runtime.project_id !== project.id) throw new Error('runtime.json belongs to a different project.');
  let info;
  try { info = await serviceClient(project, runtime).json('GET', '/api/info', undefined, { signal: AbortSignal.timeout(2000) }); }
  catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return { running: false, project: project.root, data_dir: project.dataDir };
    throw new Error(`Cannot verify the project service: ${error.message}`);
  }
  if (info.project?.id !== project.id || info.project.root !== project.root || info.instance_id !== runtime.instance_id) throw new Error('Service identity differs from runtime.json; refusing to manage another instance.');
  return { running: true, project: project.root, data_dir: project.dataDir, url: runtime.url, pid: runtime.pid,
    version: info.version, update_required: info.version !== version, instance_id: runtime.instance_id };
}
async function withStartLock(project, operation) {
  mkdirSync(project.dataDir, { recursive: true });
  const path = join(project.dataDir, 'start.lock');
  let fd;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { fd = openSync(path, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = readFileSync(path, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (owner) {
        try { process.kill(Number(owner), 0); }
        catch (error) {
          if (error.code !== 'ESRCH') throw error;
          throw new Error(`A previous start left a lock: ${path}. Its owner is no longer running; remove this lock and retry.`);
        }
      }
      await pause(100);
    }
  }
  if (fd === undefined) throw new Error('Another Human Use start is in progress. Retry after it finishes.');
  writeFileSync(fd, String(process.pid)); closeSync(fd);
  try { return await operation(); }
  finally { unlinkSync(path); }
}
export async function startService(project) {
  return withStartLock(project, async () => {
    const status = await serviceStatus(project);
    if (status.running) {
      if (status.update_required) throw new Error(`Service ${status.version} is running; CLI is ${version}. Run human-use stop, then human-use start.`);
      return { ...status, reused: true };
    }
    const log = openSync(join(project.dataDir, 'service.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
      cwd: project.root, detached: true, windowsHide: true, stdio: ['ignore', log, log, 'ipc'],
      env: { ...process.env, HUMAN_USE_PROJECT: project.root, HUMAN_USE_INSTANCE: randomUUID(), PORT: '0' },
    });
    closeSync(log);
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); child.off('error', failed); child.off('exit', exited); child.off('message', ready);
        if (child.connected) child.disconnect(); child.unref();
        if (error) reject(error); else resolve();
      };
      const failed = error => finish(error);
      const exited = code => finish(new Error(`Human Use service exited (${code}). See ${join(project.dataDir, 'service.log')}`));
      const ready = message => { if (message.type === 'ready') finish(); };
      const timer = setTimeout(() => { child.kill(); finish(new Error(`Service startup timed out. See ${join(project.dataDir, 'service.log')}`)); }, 10000);
      child.once('error', failed); child.once('exit', exited); child.on('message', ready);
    });
    return { ...await serviceStatus(project), reused: false };
  });
}
export async function stopService(project) {
  return withStartLock(project, async () => {
    const status = await serviceStatus(project);
    if (!status.running) {
      if (existsSync(runtimePath(project))) unlinkSync(runtimePath(project));
      return status;
    }
    await serviceClient(project, status).json('POST', '/api/service/stop', { instance_id: status.instance_id });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!existsSync(runtimePath(project))) return { running: false, project: project.root, data_dir: project.dataDir };
      await pause(100);
    }
    throw new Error('The service has not stopped yet. Check status and service.log.');
  });
}
export async function projectClient(project, { start = false } = {}) {
  const status = start ? await startService(project) : await serviceStatus(project);
  if (!status.running) throw new Error('Project service is stopped. Run human-use start.');
  if (status.update_required) throw new Error('Service and CLI versions differ. Stop and restart the project service.');
  return serviceClient(project, status);
}
export async function openBrowser(url) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('Only local Human Use URLs can be opened.');
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', target.href] : [target.href];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', error => reject(new Error(`Browser could not be opened: ${error.message}. Service is running at ${target.href}`)));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser launcher exited ${code}. Open ${target.href}`)));
  });
}
