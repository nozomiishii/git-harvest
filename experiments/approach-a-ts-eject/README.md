# Approach A — TS source of truth, eject generates shell

Prototype for the `eject` discussion ([#138](https://github.com/nozomiishii/git-harvest/issues/138), [#169](https://github.com/nozomiishii/git-harvest/issues/169)). Paired with approach B (`proto/shell-core`). Self-contained, off `main`, not for merge.

## Idea

The logic stays in TS (`src/`), runs in TS, and is unit-testable. `eject` is a generator (`src/eject.ts`) that assembles a minimal POSIX shell from the resolved flags — only the components that config needs.

Because flags are thresholds (data), most ejected scripts share the same shape with different constants. The exception is `--yolo`: it deletes every stage, so its script drops merge detection (`is_merged`) entirely.

```sh
node bin via tsx:
  tsx src/cli.ts                      # default: remove merged worktrees + branches
  tsx src/cli.ts --worktree-committed
  tsx src/cli.ts --yolo
  tsx src/cli.ts eject --yolo         # prints a short script (no is_merged)
  tsx src/cli.ts eject                # prints a longer script (with is_merged)
  vitest run                          # typed + behavioral tests
```

(Install first: `pnpm i`. Run with `pnpm start` / `pnpm test`.)

## Scope (prototype)

Three cases: `default` / `--worktree-committed` / `--yolo`. merged = real + squash. Invariants: main worktree, current worktree, base branch, current HEAD. Same omissions as approach B (session/locked, `.claude` scope, detached/untouched, dry-run, multi-OS, cherry-pick fallback).

## Trade-offs

Gains
- type safety; fast precise unit tests (`eject()` is a pure function; `parseWorktrees` is tested on plain strings — see `core.test.ts`)
- robust parsing in TS (`slice`, not `awk $2`, so paths with spaces survive)
- keeps the direction of [#180](https://github.com/nozomiishii/git-harvest/pull/180)
- nicer flag/help UX (citty etc.) fits naturally on the TS side

Costs
- the ejected shell is a SECOND expression of the logic. The generator must stay in sync with the TS, and correctness of the emitted shell needs its own check (generate + run against a fixture)
- not a single source of truth: a bug fixed in TS must be mirrored in the shell components
- `eject` fidelity is only as good as the generator; it is not literally the runtime (unlike approach B)
