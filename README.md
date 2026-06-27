# Meeting Translator

> Local, real-time meeting transcription & translation for macOS — audio and text never leave your machine.

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

## Features

- Real-time microphone transcription: Chinese / Japanese / English / Korean / Cantonese (auto-detected)
- Live captions — partial results appear while you speak, finalized when the segment ends
- **Native-language driven** — pick your language on first launch; the whole UI is shown in it, and when translation is on, everything spoken in other languages is translated into your language
- Switchable translation engine:
  - **Local** (default): M2M100 runs on-device — downloaded once, then works offline; text never leaves your machine
  - **Cloud** (optional): any OpenAI-compatible endpoint (set Base URL / API Key / Model in Settings; the key is stored only on your device) — enabling it means text is sent to a third party
- Settings: native language, transcript font size, translation engine
- Runs in real time on CPU (RTF ≈ 0.03 on Apple Silicon), no GPU required

## Usage

1. **First launch** — choose your language on the onboarding screen.
2. Click **Start Recording** — captions appear live as you speak.
3. Toggle **Translate** to show a translation into your language under each line.
4. Open **Settings** (⚙) to change language, font size, or translation engine (and cloud credentials).

The first time you start recording, macOS asks for microphone permission.

## Development

Built with **electron-vite** (Vite + Vue 3 + Naive UI). Main/preload/renderer all in TypeScript under `src/`.

```bash
npm install
npm run download-models   # ~230MB into models/
npm run dev               # dev with hot reload
# production preview: npm run build && npm start
```

Other scripts: `npm run build`, `npm run type-check`, `npm run clean`.

### Offline testing (no GUI)

```bash
npm run test-pipeline -- test.wav   # transcription, needs 16kHz mono
# convert: afconvert -f WAVE -d LEI16@16000 -c 1 in.wav out.wav

npm run test-translate              # multi-direction translation (downloads model on first run)
```

## Models

| Model | Purpose | Size | How |
|---|---|---|---|
| Silero VAD | voice activity detection | 629KB | `npm run download-models` |
| SenseVoice (int8) | multilingual ASR | ~230MB | `npm run download-models` |
| M2M100-418M (int8) | multilingual translation | ~630MB | auto-downloaded to `models/transformers/` on first translation |

## Architecture

```
Renderer                              Main process
Microphone (getUserMedia)
  └─ AudioWorklet → 16kHz PCM
       └─ IPC ─────────────────────▶ Silero VAD  (segment speech)
                                        └─ SenseVoice ASR  (zh/en/ja/ko/yue)
                                             ├─ while speaking → partial decode (live)
                                             └─ on segment end → final result
                                                  └─ M2M100 translation (pluggable)
       transcript + translation ◀──── IPC
```

Transcription uses [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (ONNX Runtime, native N-API module); translation uses [Transformers.js](https://github.com/huggingface/transformers.js) running Meta M2M100-418M (MIT), also on onnxruntime. Translation sits behind the `Translator` interface in `src/translation/` — swapping in a stronger local model or a cloud API is just another implementation.

## Roadmap

- [ ] Higher-quality local translation (e.g. an LLM backend like Qwen2.5)
- [ ] Export transcripts (Markdown / SRT)
- [ ] Packaging & distribution (electron-builder, models downloaded on first launch)
