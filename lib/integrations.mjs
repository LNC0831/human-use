import { existsSync, readFileSync, readdirSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { managedBlock, writeChanged } from './project.mjs';
import { version } from './version.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const cli = join(packageRoot, 'cli.mjs');
const marker = '--managed-human-use';
const psPrefix = 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ';
const owned = hook => typeof hook.command === 'string' && (hook.command.includes(marker)
  || (hook.command.startsWith(psPrefix) && Buffer.from(hook.command.slice(psPrefix.length), 'base64').toString('utf16le').includes(marker)));
function hookCommand(client, mode) {
  const args = `hook --client ${client} --mode ${mode} --seconds 20 ${marker}`;
  if (process.platform === 'win32') {
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const script = `& ${quote(process.execPath)} ${quote(cli)} ${args}; exit $LASTEXITCODE`;
    return psPrefix + Buffer.from(script, 'utf16le').toString('base64');
  }
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  return `${quote(process.execPath)} ${quote(cli)} ${args}`;
}

export function integrate(project, client, { hooks = true, mcp = false } = {}) {
  if (!['codex', 'claude'].includes(client)) throw new Error('Supported clients: codex, claude');
  const files = [];
  if (hooks) {
    const path = join(project.root, client === 'codex' ? '.codex/hooks.json' : '.claude/settings.local.json');
    const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    config.hooks ||= {};
    for (const [event, mode] of [['SessionStart', 'context'], ['UserPromptSubmit', 'context'], ['PostToolUse', 'notify'], ['Stop', 'stop']]) {
      const command = hookCommand(client, mode);
      const entries = (config.hooks[event] || []).map(entry => ({ ...entry, hooks: entry.hooks.filter(hook => !owned(hook)) })).filter(entry => entry.hooks.length);
      entries.push({ ...(event === 'PostToolUse' ? { matcher: client === 'codex' ? 'Write|Edit|apply_patch' : 'Write|Edit' } : {}), hooks: [{ type: 'command', command, timeout: event === 'Stop' ? 30 : 10 }] });
      config.hooks[event] = entries;
    }
    writeChanged(path, JSON.stringify(config, null, 2) + '\n'); files.push(path);
  }
  if (mcp && client === 'codex') {
    const path = join(project.root, '.codex/config.toml');
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (!previous.includes('# >>> Human Use MCP') && /^\s*\[mcp_servers\.(?:human-use|"human-use")\]\s*$/m.test(previous)) throw new Error('An unmanaged human-use MCP entry already exists. Preserve it or remove it before enabling this one.');
    managedBlock(path, 'Human Use MCP', `[mcp_servers.human-use]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([cli, 'mcp', '--project', project.root, marker])}\ntool_timeout_sec = 35`);
    files.push(path);
  }
  if (mcp && client === 'claude') {
    const path = join(project.root, '.mcp.json');
    const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    config.mcpServers ||= {};
    const previous = config.mcpServers['human-use'];
    if (previous && !previous.args?.includes(marker)) throw new Error('An unmanaged human-use MCP entry already exists.');
    config.mcpServers['human-use'] = { command: process.execPath, args: [cli, 'mcp', '--project', project.root, marker] };
    writeChanged(path, JSON.stringify(config, null, 2) + '\n'); files.push(path);
  }
  return { client, files, hooks, mcp, notice: 'Project hooks require client review/trust and may need a new session. MCP configuration may need a client restart. Skill + API works independently.' };
}

export function setupCodex({ skillsDir = join(homedir(), '.agents', 'skills') } = {}) {
  skillsDir = resolve(skillsDir);
  const names = ['human-use', 'human-use-setup'];
  // Check both destinations before replacing any owned installation.
  for (const name of names) {
    const target = join(skillsDir, name), record = join(target, '.human-use-install.json');
    if (existsSync(target) && readdirSync(target).length && (!existsSync(record) || JSON.parse(readFileSync(record, 'utf8')).owner !== 'human-use')) throw new Error(`Existing skill is not managed by Human Use: ${target}`);
  }
  const wrapper = `import { main } from ${JSON.stringify(pathToFileURL(cli).href)};\nmain(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });\n`;
  for (const name of names) {
    const target = join(skillsDir, name);
    mkdirSync(target, { recursive: true });
    cpSync(join(packageRoot, 'skills', name), target, { recursive: true });
    mkdirSync(join(target, 'scripts'), { recursive: true });
    writeFileSync(join(target, 'scripts', 'cli.mjs'), wrapper);
    writeFileSync(join(target, '.human-use-install.json'), JSON.stringify({ owner: 'human-use', package_root: packageRoot, version }, null, 2) + '\n');
  }
  return { client: 'codex', version, skills: names.map(name => join(skillsDir, name)), notice: 'Skills installed. Open a new Codex session if they are not visible; then ask to introduce Human Use into the current project.' };
}
