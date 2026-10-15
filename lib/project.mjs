import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export function locateProject(start = process.cwd()) {
  let root = realpathSync(resolve(start));
  while (true) {
    if (existsSync(join(root, 'human-use.json'))) return loadProject(root);
    const parent = dirname(root);
    if (parent === root) throw new Error('Human Use is not initialized here. Run human-use init --project <directory>.');
    root = parent;
  }
}
export function loadProject(root) {
  root = realpathSync(resolve(root));
  const config = JSON.parse(readFileSync(join(root, 'human-use.json'), 'utf8'));
  if (config.version !== 1 || typeof config.id !== 'string' || typeof config.name !== 'string') throw new Error('Unsupported human-use.json project configuration.');
  return { ...config, root, dataDir: join(root, '.human-use') };
}
export function writeChanged(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
export function managedBlock(path, marker, content) {
  const begin = `# >>> ${marker}`, end = `# <<< ${marker}`;
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const first = previous.indexOf(begin), last = previous.indexOf(end);
  if ((first < 0) !== (last < 0) || (first >= 0 && last < first)) throw new Error(`Incomplete managed block in ${path}`);
  const block = `${begin}\n${content}\n${end}`;
  const next = first < 0 ? `${previous}${previous.endsWith('\n') || !previous ? '' : '\n'}${previous ? '\n' : ''}${block}\n`
    : previous.slice(0, first) + block + previous.slice(last + end.length);
  writeChanged(path, next);
}
export function initializeProject(directory = process.cwd()) {
  const root = realpathSync(resolve(directory));
  const path = join(root, 'human-use.json');
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ version: 1, id: randomUUID(), name: basename(root) }, null, 2) + '\n', { flag: 'wx' });
  const project = loadProject(root);
  managedBlock(join(root, '.gitignore'), 'Human Use', '/.human-use/\n/.human-use-migrate-*/\n/.codex/hooks.json\n/.codex/config.toml\n/.claude/settings.local.json\n/.mcp.json');
  managedBlock(join(root, 'AGENTS.md'), 'Human Use', [
    'Human Use is enabled for this project. Use the installed human-use skill when a person must perform an action or supply evidence.',
    'Run `human-use status` to locate the project service; use `human-use api` for the authenticated API. Run from this project or pass `--project <directory>`.',
    'Never fabricate human answers, operate the human submission interface, or accept evidence without inspecting it. Existing project instructions remain applicable.',
  ].join('\n'));
  return project;
}
