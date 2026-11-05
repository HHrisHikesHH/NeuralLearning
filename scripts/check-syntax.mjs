// Static check without a toolchain: parse every JavaScript file with `node --check`.
// package.json sets "type": "module", so .js files are checked as ES modules, as browsers load them.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['js', 'tests', 'e2e', 'scripts'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(name)) files.push(p);
  }
};
for (const d of DIRS) { try { walk(join(ROOT, d)); } catch { /* directory absent */ } }
files.push(join(ROOT, 'playwright.config.js'));

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✖ ${relative(ROOT, f)}\n${r.stderr}`); }
}
console.log(`${failed ? '✖' : '✔'} syntax check: ${files.length - failed}/${files.length} files parse`);
process.exit(failed ? 1 : 0);
