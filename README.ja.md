# Meeting Translator

> macOS 向けのローカル・リアルタイム会議文字起こし＆翻訳——音声もテキストも端末から出ません。

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

## 機能

- リアルタイムのマイク文字起こし：中国語 / 日本語 / 英語 / 韓国語 / 広東語（自動判定）
- ライブ字幕——話している間に途中結果を表示し、発話区切りで確定
- **母語ドリブン**——初回起動で母語を選択；UI 全体が母語で表示され、翻訳をオンにすると会議中の他言語はすべて母語に翻訳
- 翻訳エンジンを切り替え可能：
  - **ローカル**（既定）：M2M100 を端末上で実行——初回ダウンロード後はオフラインで動作し、テキストは端末外に出ません
  - **クラウド**（任意）：OpenAI 互換の任意エンドポイント（設定で Base URL / API Key / モデルを入力；キーは端末にのみ保存）——有効にするとテキストは第三者に送信されます
- 設定：母語、文字サイズ、翻訳方式
- CPU のみでリアルタイム動作（Apple Silicon 実測 RTF ≈ 0.03）、GPU 不要

## 使い方

1. **初回起動**——オンボーディング画面で言語を選択。
2. **録音開始**をクリック——話すと字幕がリアルタイムに表示。
3. **翻訳**をオンにすると各行の下に母語訳が表示。
4. **⚙ 設定**で母語・文字サイズ・翻訳方式（およびクラウド認証情報）を変更。

初回の録音開始時に macOS がマイクの許可を求めます。

## 開発

**electron-vite**（Vite + Vue 3 + Naive UI）で構築。メイン / preload / レンダラはすべて TypeScript（`src/`）。

```bash
npm install
npm run download-models   # 約 230MB を models/ へ
npm run dev               # 開発（ホットリロード）
# 本番プレビュー：npm run build && npm start
```

その他のスクリプト：`npm run build`、`npm run type-check`、`npm run clean`。

### オフライン検証（GUI 不要）

```bash
npm run test-pipeline -- test.wav   # 文字起こし、16kHz モノラルが必要
# 変換: afconvert -f WAVE -d LEI16@16000 -c 1 in.wav out.wav

npm run test-translate              # 多方向翻訳（初回はモデルをダウンロード）
```

## モデル

| モデル | 用途 | サイズ | 取得 |
|---|---|---|---|
| Silero VAD | 音声区間検出 | 629KB | `npm run download-models` |
| SenseVoice (int8) | 多言語音声認識 | 約 230MB | `npm run download-models` |
| M2M100-418M (int8) | 多言語翻訳 | 約 630MB | 初回翻訳時に `models/transformers/` へ自動ダウンロード |

## アーキテクチャ

```
レンダラ                              メインプロセス
マイク (getUserMedia)
  └─ AudioWorklet で 16kHz PCM を取得
       └─ IPC ─────────────────────▶ Silero VAD で発話を分割
                                        └─ SenseVoice 認識 (zh/en/ja/ko/yue)
                                             ├─ 発話中 → 途中認識（ライブ）
                                             └─ 区切りで → 確定結果
                                                  └─ M2M100 翻訳（差し替え可能）
       文字起こし + 訳文 ◀────────── IPC
```

文字起こしは [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（ONNX Runtime、ネイティブ N-API モジュール）、翻訳は [Transformers.js](https://github.com/huggingface/transformers.js) で Meta M2M100-418M（MIT）を実行（こちらも onnxruntime）。翻訳機能は `src/translation/` の `Translator` インターフェースの背後にあり——より強力なローカルモデルやクラウド API への差し替えは実装を 1 つ追加するだけです。

## ロードマップ

- [ ] より高品質なローカル翻訳（Qwen2.5 などの LLM バックエンド）
- [ ] 議事録のエクスポート（Markdown / SRT）
- [ ] パッケージ配布（electron-builder、モデルは初回起動時にダウンロード）
