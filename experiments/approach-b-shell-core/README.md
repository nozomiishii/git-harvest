# Approach B — shell as the single source of truth

Prototype for the `eject` discussion ([#138](https://github.com/nozomiishii/git-harvest/issues/138), [#169](https://github.com/nozomiishii/git-harvest/issues/169)). Paired with approach A (`proto/eject-ts`). Self-contained, off `main`, not for merge.

## Idea

One POSIX shell script, `git-harvest.sh`, is the entire implementation. The JS layer (`bin.mjs`, ~20 lines, no dependencies) only:

- runs the script, forwarding flags verbatim, or
- ejects it — copies the exact script that runs.

So `eject` has perfect fidelity: the ejected artifact IS the runtime, and it needs only `sh` + `git` (zero runtime deps).

## Scope (prototype)

Three cases: `default` / `--worktree-committed` / `--yolo`.

- merged detection: real merge (ancestor) + squash (virtual squash commit + `git cherry`)
- invariants kept: main worktree, current worktree, base branch, current HEAD

Omitted to stay small (the real tool has these): running-session / locked protection, `.claude/worktrees/` scope, detached / untouched flags, dry-run, multi-OS session paths, cherry-pick (orphan) merge fallback.

## Run

```sh
node bin.mjs                     # default: remove merged worktrees + branches
node bin.mjs --worktree-committed
node bin.mjs --yolo
node bin.mjs eject ./git-harvest.sh   # copy the standalone script out
sh test.sh                       # behavioral test on a fixture repo
```

## Trade-offs

Gains
- one implementation, no sync tax between TS and shell
- `eject` equals the runtime — perfect fidelity, and a dependency-free standalone artifact for strict environments
- the JS layer is tiny; nicer flag/help UX (citty etc.) could sit on top, but is optional

Costs
- no type safety; the descriptor / `tsc` exhaustiveness from the TS tool is gone
- the fragile parsing lives in shell. Note `awk '{sub(/^worktree /,"")}'` instead of `$2` so worktree paths with spaces survive; session-JSON reading (omitted here) is the brittle part
- tests are behavioral only (`test.sh` against a fixture); no fast, precise typed unit tests
- flag parsing belongs to the shell (so the ejected script is standalone), so a TS/citty layer can't own flags without duplicating them
- this reverses the direction of [#180](https://github.com/nozomiishii/git-harvest/pull/180), which moved the implementation into TS for testability/maintainability
