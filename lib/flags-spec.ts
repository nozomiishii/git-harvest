import type { Flags, Stage } from "./types";
import { SAFETY } from "./types";

export type FlagSpec = BooleanFlag | ThresholdFlag;

type BooleanFlag = {
  field:
    | "claudeWorktreeDetached"
    | "claudeWorktreeUntouched"
    | "worktreeDetached"
    | "worktreeUntouched";
  group: string;
  help: string;
  kind: "boolean";
  token: string;
  warning?: string;
};

// 1 フラグの定義。token・効果・help を1か所に持つ。parse / help / preset がこれを参照する。
//   threshold: scope の閾値を stage まで下げる（より危険側）
//   boolean:   detached / untouched の専用 boolean を立てる
type ThresholdFlag = {
  field: "branch" | "claudeWorktree" | "worktree";
  group: string;
  help: string;
  kind: "threshold";
  stage: Stage;
  token: string;
  warning?: string;
};

// help の Options 説明開始カラム（2 indent + token 幅）。warning 継続行もこの幅で揃える。
const HELP_COL = 36;

// help のグループ見出し（表示順）。各 spec は group キーでここに紐づく。
const HELP_GROUPS: { header: string; key: string }[] = [
  {
    header: "Worktree threshold (normal path), deletes the stage and everything safer:",
    key: "worktree",
  },
  { header: "Worktree threshold (.claude/worktrees/ path):", key: "claudeWorktree" },
  { header: "Branch threshold (branches have no files-changed):", key: "branch" },
  { header: "Off-ladder worktrees (kept by default):", key: "offLadder" },
];

// 全フラグ定義。配列順が help の各グループ内の表示順になる。
export const FLAG_SPECS: FlagSpec[] = [
  {
    field: "worktree",
    group: "worktree",
    help: "Delete from files-changed (everything, uncommitted included)",
    kind: "threshold",
    stage: "files-changed",
    token: "--worktree-files-changed",
  },
  {
    field: "worktree",
    group: "worktree",
    help: "Delete from committed (committed and merged)",
    kind: "threshold",
    stage: "committed",
    token: "--worktree-committed",
  },
  {
    field: "claudeWorktree",
    group: "claudeWorktree",
    help: "Delete from files-changed (everything)",
    kind: "threshold",
    stage: "files-changed",
    token: "--claude-worktree-files-changed",
  },
  {
    field: "claudeWorktree",
    group: "claudeWorktree",
    help: "Delete from committed",
    kind: "threshold",
    stage: "committed",
    token: "--claude-worktree-committed",
  },
  {
    field: "branch",
    group: "branch",
    help: "Delete from committed (everything)",
    kind: "threshold",
    stage: "committed",
    token: "--branch-committed",
  },
  {
    field: "worktreeDetached",
    group: "offLadder",
    help: "Delete detached normal-path worktrees",
    kind: "boolean",
    token: "--worktree-detached",
    warning:
      "WARNING: a detached worktree's commits are unreachable;\nremoval can lose them permanently (no reflog recovery).",
  },
  {
    field: "claudeWorktreeDetached",
    group: "offLadder",
    help: "Delete detached .claude/worktrees/ worktrees (same warning)",
    kind: "boolean",
    token: "--claude-worktree-detached",
  },
  {
    field: "worktreeUntouched",
    group: "offLadder",
    help: "Delete untouched normal-path worktrees",
    kind: "boolean",
    token: "--worktree-untouched",
  },
  {
    field: "claudeWorktreeUntouched",
    group: "offLadder",
    help: "Delete untouched .claude/worktrees/ worktrees",
    kind: "boolean",
    token: "--claude-worktree-untouched",
  },
];

// --yolo が展開するフラグ束。ここに token を足さない限り yolo に入らない（明示的・監査可能）。
export const PRESETS = {
  yolo: [
    "--worktree-files-changed",
    "--claude-worktree-files-changed",
    "--branch-committed",
    "--worktree-detached",
    "--claude-worktree-detached",
    "--worktree-untouched",
    "--claude-worktree-untouched",
  ],
} as const;

// token を flags に適用する。一致したら true。threshold は危険側へ下げ、boolean は true を立てる。
// 未知 token は false（呼び出し側が usage エラーにする）。
export function applyToken(flags: Flags, token: string): boolean {
  const spec = FLAG_SPECS.find((s) => s.token === token);

  if (!spec) {
    return false;
  }

  // kind ごとに分けて narrowing を効かせる（field の union が混ざると書き込み型が never になる）。
  if (spec.kind === "boolean") {
    flags[spec.field] = true;

    return true;
  }

  flags[spec.field] = lowerThreshold(flags[spec.field], spec.stage);

  return true;
}

// help の Options ブロック（閾値・off-ladder の各行）を FLAG_SPECS から生成する。
// 静的な枠（intro / --yolo / Subcommands）は cli.ts 側が持つ。
export function renderFlagHelp(): string {
  return HELP_GROUPS.map((g) => {
    const lines = FLAG_SPECS.filter((s) => s.group === g.key).map((s) => helpLine(s));

    return `  ${g.header}\n${lines.join("\n")}`;
  }).join("\n\n");
}

// 1 フラグの help 行。warning があれば桁揃えの継続行を足す。
function helpLine(spec: FlagSpec): string {
  const head = `  ${spec.token.padEnd(HELP_COL - 2)}${spec.help}`;

  if (!spec.warning) {
    return head;
  }

  const pad = " ".repeat(HELP_COL);
  const cont = spec.warning
    .split("\n")
    .map((w) => `${pad}${w}`)
    .join("\n");

  return `${head}\n${cont}`;
}

// 閾値を「より危険側（SAFETY index が小さい側）」へ下げる。複数指定 / --yolo 併用でも危険側が勝つ。
function lowerThreshold(current: Stage, candidate: Stage): Stage {
  return SAFETY.indexOf(candidate) < SAFETY.indexOf(current) ? candidate : current;
}
