#!/usr/bin/env node
// Copies the WASM bindings emitted by `wasm-pack` from
// `crates/wasm/pkg/` into `web/public/wasm/` so Vite serves them as
// static assets. Re-runs are cheap (overwrites) and idempotent.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const pkgDir = join(repoRoot, 'crates', 'wasm', 'pkg');
// Copy into `web/src/wasm/` (not `web/public/wasm/`) so Vite treats the
// bindings as a module — files in `public/` are served as-is and can't
// be `import()`ed from source.
const destDir = join(repoRoot, 'web', 'src', 'wasm');

const FILES = ['numera_wasm.js', 'numera_wasm.d.ts', 'numera_wasm_bg.wasm'];

if (!existsSync(pkgDir)) {
  console.error(`[sync-wasm] missing ${pkgDir}; run "npm run build:wasm" first.`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

for (const name of FILES) {
  copyFileSync(join(pkgDir, name), join(destDir, name));
}

console.log(`[sync-wasm] copied ${FILES.length} files to ${destDir}`);
