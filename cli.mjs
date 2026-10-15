#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeProject, locateProject } from './lib/project.mjs';
import { startService, stopService, serviceStatus, openBrowser, projectClient } from './lib/service.mjs';
import { integrate, setupCodex } from './lib/integrations.mjs';
import { migrateData } from './lib/migrate.mjs';
import { main as apiMain } from './skills/human-use/scripts/api.mjs';
import { version } from './lib/version.mjs';

const help = `Human Use ${version} — local human/AI work orders

  human-use setup codex [--skills-dir <directory>]
  human-use init [--project <directory>] [--client codex|claude] [--no-open] [--no-hooks]
  human-use start|stop|status|open [--project <directory>]
  human-use api GET /api/tickets [--project <directory>]
  human-use api POST /api/tickets request.json [--project <directory>]
  human-use api GET /api/... --out evidence.png [--project <directory>]
  human-use integrate codex|claude [--mcp] [--no-hooks] [--project <directory>]
  human-use mcp [--project <directory>]
  human-use migrate --from <stopped-data-directory> [--project <directory>]

Projects keep data in .human-use/. Setup installs user-level skills; init only changes the selected project.
All management commands return JSON. No command prints the API token.
`;
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    project: { type: 'string' }, client: { type: 'string', default: 'codex' }, 'skills-dir': { type: 'string' }, from: { type: 'string' }, out: { type: 'string' },
    'no-open': { type: 'boolean' }, 'no-hooks': { type: 'boolean' }, mcp: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    mode: { type: 'string' }, seconds: { type: 'string' }, 'managed-human-use': { type: 'boolean' },
  } });
  if (values.version) { console.log(version); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  const [command, ...rest] = positionals;
  let result;
  if (command === 'setup') {
    if (rest[0] !== 'codex') throw new Error('Usage: human-use setup codex');
    result = setupCodex({ skillsDir: values['skills-dir'] });
  } else if (command === 'init') {
    const project = initializeProject(values.project);
    const integration = integrate(project, values.client, { hooks: !values['no-hooks'], mcp: values.mcp });
    result = { ...await startService(project), integration };
    if (!values['no-open']) await openBrowser(result.url);
  } else if (command === 'migrate') {
    if (!values.from) throw new Error('Migration requires --from <stopped-data-directory>. Source is copied, not deleted.');
    result = migrateData(values.project, values.from);
  } else if (command === 'hook') {
    // The actual lifecycle input supplies cwd; project hooks must follow that session.
    if (values.project) process.env.HUMAN_USE_PROJECT = locateProject(values.project).root;
    await import('./tools/hook.mjs'); return;
  } else {
    const project = locateProject(values.project);
    if (command === 'status') result = await serviceStatus(project);
    else if (command === 'start') result = await startService(project);
    else if (command === 'stop') result = await stopService(project);
    else if (command === 'open') { result = await startService(project); await openBrowser(result.url); }
    else if (command === 'integrate') result = integrate(project, rest[0] || values.client, { hooks: !values['no-hooks'], mcp: values.mcp });
    else if (command === 'api') {
      await apiMain([...rest, ...(values.out ? ['--out', values.out] : [])], { client: await projectClient(project, { start: true }) }); return;
    } else if (command === 'mcp') {
      process.env.HUMAN_USE_PROJECT = project.root;
      await import('./mcp/server.mjs'); return;
    } else throw new Error(`Unknown command: ${command}. Run human-use --help.`);
  }
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Human Use: ${error.message}`); process.exitCode = 1; });
}
