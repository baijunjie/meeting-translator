#!/usr/bin/env bash
# 下载本地推理所需的模型文件到 models/ 目录：
#   - Silero VAD          语音活动检测（约 2MB）
#   - SenseVoice int8     语音识别，支持 zh/en/ja/ko/yue（约 240MB）
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p models
cd models

RELEASE_BASE="https://github.com/k2-fsa/sherpa-onnx/releases/download"

if [ ! -f silero_vad.onnx ]; then
  echo "==> Downloading Silero VAD..."
  curl -fL -o silero_vad.onnx "$RELEASE_BASE/asr-models/silero_vad.onnx"
fi

SENSE_VOICE_DIR="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
if [ ! -d "$SENSE_VOICE_DIR" ]; then
  echo "==> Downloading SenseVoice ASR model..."
  curl -fL -o "$SENSE_VOICE_DIR.tar.bz2" "$RELEASE_BASE/asr-models/$SENSE_VOICE_DIR.tar.bz2"
  tar xf "$SENSE_VOICE_DIR.tar.bz2"
  rm "$SENSE_VOICE_DIR.tar.bz2"
  # 只用 int8 量化版，删掉压缩包里附带的全精度模型（约 900MB）
  rm -f "$SENSE_VOICE_DIR/model.onnx"
fi

echo "==> All models ready:"
ls -lh
