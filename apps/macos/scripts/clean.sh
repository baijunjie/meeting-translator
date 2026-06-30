#!/usr/bin/env bash
# 清理构建产物与缓存。
#
# 用法：
#   bash scripts/clean.sh                       # 构建产物 + Vite 缓存
#   bash scripts/clean.sh --models              # 额外清理翻译模型缓存（下次翻译时重新下载）
#   bash scripts/clean.sh --settings            # 额外清理用户设置（下次启动回到首次引导）
#   bash scripts/clean.sh --all                 # 完全重置：删全部模型(含 ASR) + 用户设置（模拟全新安装）
#
# 注意：除 --all 外，ASR 模型（silero_vad.onnx / sense-voice）不会被清理。
set -euo pipefail

cd "$(dirname "$0")/.."

SETTINGS_FILE="$HOME/Library/Application Support/meeting-translator/settings.json"

rm -rf out release dist-test node_modules/.vite ../../.deploy-macos
echo "✓ 已清理构建产物与缓存：out/  release/  dist-test/  node_modules/.vite  .deploy-macos/"

asr_wiped=false
for arg in "$@"; do
  case "$arg" in
    --all)
      rm -rf models
      rm -f "$SETTINGS_FILE"
      asr_wiped=true
      echo "✓ 已删除全部模型（models/，含 ASR + 翻译）与用户设置 → 完全回到全新安装状态"
      ;;
    --models)
      rm -rf models/transformers
      echo "✓ 已清理翻译模型缓存：models/transformers/（下次翻译会重新下载约 630MB）"
      ;;
    --settings)
      rm -f "$SETTINGS_FILE"
      echo "✓ 已清理用户设置（下次启动回到首次引导向导）"
      ;;
    *)
      echo "⚠ 未知参数：$arg（可用：--models / --settings / --all）"
      ;;
  esac
done

if [[ "$asr_wiped" == false ]]; then
  echo "ℹ ASR 模型未触碰；如缺失，下次启动应用会自动重新下载。"
fi
