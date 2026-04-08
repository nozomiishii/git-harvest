#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# デモ GIF 生成スクリプト
#
# VHS (https://github.com/charmbracelet/vhs) を Docker 経由で
# 実行し、各コマンドのデモ GIF を生成する。
#
# 使い方: bash demo/create.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="git-harvest-vhs"
DOCKERFILE="$PROJECT_ROOT/demo/Dockerfile"

# ----------------------------------------------------------
# 1. Docker イメージをビルド
# ----------------------------------------------------------
echo "Building Docker image..."
docker build \
  -t "$IMAGE_NAME" \
  -f "$DOCKERFILE" \
  "$PROJECT_ROOT"

echo "Build complete."

# ----------------------------------------------------------
# 2. 各テープファイルを実行して GIF を生成
# ----------------------------------------------------------
echo ""
echo "Generating demo files..."

for tape in "$PROJECT_ROOT"/demo/*.tape; do
  name="$(basename "$tape" .tape)"
  echo "  > $name"
  docker run --rm \
    -v "$PROJECT_ROOT":/vhs \
    "$IMAGE_NAME" \
    "demo/${name}.tape"
done

# ----------------------------------------------------------
# 3. 完了メッセージ
# ----------------------------------------------------------
echo ""
echo "Done. Generated files:"
for file in "$PROJECT_ROOT"/demo/*.gif "$PROJECT_ROOT"/demo/*.png; do
  [ -f "$file" ] && echo "  $file"
done
