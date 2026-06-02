#!/usr/bin/env node
// approach B: the shell script is the single source of truth.
// This JS layer is intentionally thin and dependency-free. It either
//   (a) runs the shell, forwarding flags verbatim, or
//   (b) ejects it — copies the exact script that runs, so the ejected
//       artifact has perfect fidelity (it IS the runtime).
//
// In the real tool this layer is where nicer flag/help UX (e.g. citty) would
// live; kept as plain ESM here to show how little the JS side needs to carry.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'git-harvest.sh');
const argv = process.argv.slice(2);

if (argv[0] === 'eject') {
  const dest = argv[1] ?? join(process.cwd(), 'git-harvest.sh');
  copyFileSync(script, dest);
  chmodSync(dest, 0o755);
  console.log(`ejected: ${dest}`);
  process.exit(0);
}

const r = spawnSync('sh', [script, ...argv], { stdio: 'inherit' });
process.exit(r.status ?? 1);
