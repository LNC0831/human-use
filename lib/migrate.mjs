import { existsSync, readdirSync, cpSync, rmdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeProject } from './project.mjs';

export function migrateData(directory, source) {
  source = resolve(source);
  if (!existsSync(join(source, 'workorders.sqlite')) || !existsSync(join(source, 'api-token'))) throw new Error('Source must be a stopped Human Use data directory containing workorders.sqlite and api-token.');
  const project = initializeProject(directory);
  if (existsSync(project.dataDir) && readdirSync(project.dataDir).length) throw new Error('Destination .human-use is not empty. Migration never overwrites an existing project.');
  if (existsSync(join(source, 'runtime.json'))) throw new Error('Stop the source service before migration.');
  const temp = join(project.root, `.human-use-migrate-${randomUUID()}`);
  cpSync(source, temp, { recursive: true, errorOnExist: true, force: false });
  const db = new DatabaseSync(join(temp, 'workorders.sqlite'));
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error(`Copied database is invalid. Inspect ${temp}; source is unchanged.`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { db.close(); }
  writeFileSync(join(temp, 'api-token'), randomBytes(32).toString('hex'), { mode: 0o600 });
  // An empty destination can exist after configuration, but no evidence is replaced.
  if (existsSync(project.dataDir)) rmdirSync(project.dataDir);
  renameSync(temp, project.dataDir);
  return { project: project.root, data_dir: project.dataDir, copied_from: source, source_preserved: true };
}
