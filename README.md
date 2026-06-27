# Meeting Translator

macOS 本地会议转写工具：实时录音转文字，并可本地翻译。所有推理在本地完成，音频与文本不上传任何服务器。

## 功能

- 实时麦克风录音转写，支持中文 / 日语 / 英语 / 韩语 / 粤语（自动检测）
- 文字实时上屏：说话过程中即显示部分识别结果，语音段结束后定稿
- **母语驱动**：首次启动引导选择母语；整个界面用母语呈现（中 / 日 / 英 / 韩），开启翻译后会议中其他语言统一翻成母语
- 翻译引擎可切换：
  - **本地**（默认）：M2M100 模型本地运行，首次联网下载后离线可用，文本不出机器
  - **云端**（可选）：任意 OpenAI 兼容端点（设置里填 Base URL / API Key / 模型，密钥仅存本机）；启用即表示文本会发往第三方
- 设置页：母语、转写字体大小、翻译方式
- 纯 CPU 实时运行（Apple Silicon 实测 RTF ≈ 0.03），无需 GPU

## 技术架构

```
渲染进程                          主进程
麦克风 (getUserMedia)
  └─ AudioWorklet 采集 16kHz PCM
       └─ IPC ──────────────────▶ Silero VAD 切分语音段
                                    └─ SenseVoice 语音识别 (zh/en/ja/ko/yue)
                                         ├─ 说话中：周期性部分识别（实时上屏）
                                         └─ 段结束：最终结果
                                              └─ M2M100 翻译（可插拔，按需）
       转写 + 译文 ◀───────────── IPC
```

转写引擎为 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（ONNX Runtime，N-API 原生模块）；翻译用 [Transformers.js](https://github.com/huggingface/transformers.js) 跑 Meta M2M100-418M（MIT），同样基于 onnxruntime。翻译能力封装在 `src/translation/` 的 `Translator` 接口后，换更强的本地模型或接云 API 只需新增一个实现。

## 开发

代码使用 TypeScript（`src/`），`tsc` 编译到 `dist/`，`npm start` 会先构建再启动 Electron。

```bash
npm install
npm run download-models   # 下载约 230MB 模型文件到 models/
npm start                 # = npm run build + electron .
```

首次点击「开始录音」时系统会请求麦克风权限。

### 离线验证管线

不启动 GUI，直接用 WAV 文件测试转写：

```bash
npm run test-pipeline -- test.wav   # 转写，需要 16kHz 单声道
# 格式转换: afconvert -f WAVE -d LEI16@16000 -c 1 in.wav out.wav

npm run test-translate              # 翻译多向互译（首次会下载翻译模型）
```

## 模型

| 模型 | 用途 | 大小 | 获取 |
|---|---|---|---|
| Silero VAD | 语音活动检测 | 629KB | `npm run download-models` |
| SenseVoice (int8) | 多语言语音识别 | 约 230MB | `npm run download-models` |
| M2M100-418M (int8) | 多语言翻译 | 约 630MB | 首次翻译时自动下载到 `models/transformers/` |

## Roadmap

- [ ] 更高质量本地翻译（如 Qwen2.5 等 LLM 后端）
- [ ] 会议记录导出（Markdown / SRT）
- [ ] 打包分发（electron-builder，模型首次启动下载）
