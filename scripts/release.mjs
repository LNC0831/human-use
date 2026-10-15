import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const tag = process.env.GITHUB_REF_NAME;
execFileSync(process.execPath, ['scripts/check-release.mjs', tag], { stdio: 'inherit' });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const output = resolve('.release'); mkdirSync(output, { recursive: true });
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', output], { encoding: 'utf8' }));
const archive = join(output, pack.filename);
const checksum = join(output, 'SHA256SUMS.txt');
writeFileSync(checksum, `${createHash('sha256').update(readFileSync(archive)).digest('hex')}  ${pack.filename}\n`);
execFileSync('gh', ['release', 'create', tag, archive, checksum, '--verify-tag', '--draft', '--generate-notes', '--title', `Human Use ${pkg.version}`, ...(pkg.version.includes('-') ? ['--prerelease'] : [])], { stdio: 'inherit' });
