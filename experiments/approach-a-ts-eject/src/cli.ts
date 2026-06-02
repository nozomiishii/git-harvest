import type { Flags } from './core';
import { cleanup } from './core';
import { eject } from './eject';

type Parsed = { flags: Flags; mode: 'eject' | 'run' };

function parse(argv: string[]): Parsed {
  const rest = [...argv];
  const mode: 'eject' | 'run' = rest[0] === 'eject' ? 'eject' : 'run';

  if (mode === 'eject') rest.shift();

  const flags: Flags = { worktree: 'merged', yolo: false };

  for (const arg of rest) {
    if (arg === '--worktree-committed') flags.worktree = 'committed';
    else if (arg === '--yolo') flags.yolo = true;
    else throw new Error(`unknown option: ${arg}`);
  }

  return { flags, mode };
}

async function main(argv: string[]): Promise<void> {
  let parsed: Parsed;

  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`git-harvest: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;

    return;
  }

  // runtime = TS (source of truth). eject = emit a tailored shell for the same flags.
  if (parsed.mode === 'eject') {
    process.stdout.write(eject(parsed.flags));

    return;
  }

  for (const line of await cleanup(parsed.flags)) process.stdout.write(`${line}\n`);
}

await main(process.argv.slice(2));
