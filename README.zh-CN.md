# Meeting Translator

> macOS 本地实时会议转写与翻译——音频和文本都不离开你的电脑。

[English](README.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

## 功能

- 实时麦克风转写：中文 / 日语 / 英语 / 韩语 / 粤语（自动检测）
- 实时字幕——说话过程中即显示部分结果，语音段结束后定稿
- **母语驱动**——首次启动选择母语；整个界面用母语呈现，开启翻译后会议中其他语言统一翻成母语
- 翻译引擎可切换：
  - **本地**（默认）：M2M100 在本机运行——首次下载后离线可用，文本不出机器
  - **云端**（可选）：任意 OpenAI 兼容端点（在设置里填 Base URL / API Key / 模型，密钥仅存本机）——启用即表示文本会发往第三方
- 设置页：母语、转写字体大小、翻译方式
- 纯 CPU 实时运行（Apple Silicon 实测 RTF ≈ 0.03），无需 GPU

## 使用

1. **首次启动**——在引导页选择你的语言。
2. 点击**开始录音**——字幕随说话实时出现。
3. 打开**翻译**开关——每行下方显示母语译文。
4. 点 **⚙ 设置**——可改母语、字体大小、翻译方式（及云端凭证）。

首次开始录音时，macOS 会请求麦克风权限。

## 开发

基于 **electron-vite**（Vite + Vue 3 + Naive UI）。主进程 / preload / 渲染层均为 TypeScript，位于 `src/`。

```bash
npm install
npm run download-models   # 下载约 230MB 到 models/
npm run dev               # 开发（热更新）
# 生产预览：npm run build && npm start
```

其他脚本：`npm run build`、`npm run type-check`、`npm run clean`。

### 离线测试（无需 GUI）

```bash
npm run test-pipeline -- test.wav   # 转写，需 16kHz 单声道
# 转换: afconvert -f WAVE -d LEI16@16000 -c 1 in.wav out.wav

npm run test-translate              # 多向翻译（首次会下载模型）
```

## 模型

| 模型 | 用途 | 大小 | 获取 |
|---|---|---|---|
| Silero VAD | 语音活动检测 | 629KB | `npm run download-models` |
| SenseVoice (int8) | 多语言语音识别 | 约 230MB | `npm run download-models` |
| M2M100-418M (int8) | 多语言翻译 | 约 630MB | 首次翻译时自动下载到 `models/transformers/` |

## 技术架构

```
渲染进程                              主进程
麦克风 (getUserMedia)
  └─ AudioWorklet 采集 16kHz PCM
       └─ IPC ─────────────────────▶ Silero VAD 切分语音段
                                        └─ SenseVoice 识别 (zh/en/ja/ko/yue)
                                             ├─ 说话中 → 部分识别（实时上屏）
                                             └─ 段结束 → 最终结果
                                                  └─ M2M100 翻译（可插拔）
       转写 + 译文 ◀──────────────── IPC
```

转写引擎为 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（ONNX Runtime，原生 N-API 模块）；翻译用 [Transformers.js](https://github.com/huggingface/transformers.js) 跑 Meta M2M100-418M（MIT），同样基于 onnxruntime。翻译能力封装在 `src/translation/` 的 `Translator` 接口之后——换更强的本地模型或接云 API，只是新增一个实现。

## Roadmap

- [ ] 更高质量本地翻译（如 Qwen2.5 等 LLM 后端）
- [ ] 会议记录导出（Markdown / SRT）
- [ ] 打包分发（electron-builder，模型首次启动下载）
