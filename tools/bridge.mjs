import { fileURLToPath } from 'node:url';
import { main } from '../skills/human-use/scripts/api.mjs';

main(process.argv.slice(2), { defaultDataDir: fileURLToPath(new URL('../data/', import.meta.url)) })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
