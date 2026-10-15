import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages[''].name !== pkg.name || lock.packages[''].version !== pkg.version) throw new Error('package.json and package-lock.json root identity/version must match.');
const tag = process.env.GITHUB_REF_NAME || process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Use a semantic package version.');
if (tag && tag !== `v${pkg.version}`) throw new Error(`Tag ${tag} does not match package version v${pkg.version}.`);
if (process.argv.includes('--publish')) {
  if (pkg.private) throw new Error('Publishing is disabled. Set the final npm package name and private:false after the owner is confirmed.');
  if (!pkg.repository?.url || !process.env.GITHUB_REPOSITORY || pkg.repository.url !== `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`) throw new Error('repository.url must match the publishing GitHub repository.');
}
console.log(JSON.stringify({ package: pkg.name, version: pkg.version, tag: `v${pkg.version}`, npm_tag: pkg.version.includes('-') ? 'next' : 'latest', publish_enabled: !pkg.private }));
