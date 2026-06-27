# Meeting Translator

> macOS용 로컬 실시간 회의 전사 & 번역 — 오디오와 텍스트가 기기를 벗어나지 않습니다.

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

## 기능

- 실시간 마이크 전사: 중국어 / 일본어 / 영어 / 한국어 / 광둥어 (자동 감지)
- 실시간 자막 — 말하는 동안 중간 결과 표시, 발화 구간 종료 시 확정
- **모국어 중심** — 첫 실행 시 모국어 선택; 전체 UI가 모국어로 표시되고, 번역을 켜면 회의 중 다른 언어가 모두 모국어로 번역
- 번역 엔진 전환 가능:
  - **로컬**(기본): M2M100을 기기에서 실행 — 최초 다운로드 후 오프라인 동작, 텍스트가 기기를 벗어나지 않음
  - **클라우드**(선택): OpenAI 호환 임의 엔드포인트(설정에서 Base URL / API Key / 모델 입력; 키는 기기에만 저장) — 활성화하면 텍스트가 제3자로 전송됨
- 설정: 모국어, 자막 글자 크기, 번역 방식
- CPU만으로 실시간 동작(Apple Silicon 실측 RTF ≈ 0.03), GPU 불필요

## 사용법

1. **첫 실행** — 온보딩 화면에서 언어를 선택합니다.
2. **녹음 시작**을 클릭 — 말하면 자막이 실시간으로 표시됩니다.
3. **번역** 토글을 켜면 각 줄 아래에 모국어 번역이 표시됩니다.
4. **⚙ 설정**에서 모국어 · 글자 크기 · 번역 방식(및 클라우드 자격 증명)을 변경합니다.

처음 녹음을 시작할 때 macOS가 마이크 권한을 요청합니다.

## 개발

**electron-vite**(Vite + Vue 3 + Naive UI)로 구축. 메인 / preload / 렌더러 모두 TypeScript(`src/`).

```bash
npm install
npm run download-models   # 약 230MB를 models/로
npm run dev               # 개발(핫 리로드)
# 프로덕션 미리보기: npm run build && npm start
```

기타 스크립트: `npm run build`, `npm run type-check`, `npm run clean`.

### 오프라인 테스트(GUI 불필요)

```bash
npm run test-pipeline -- test.wav   # 전사, 16kHz 모노 필요
# 변환: afconvert -f WAVE -d LEI16@16000 -c 1 in.wav out.wav

npm run test-translate              # 다방향 번역(최초 실행 시 모델 다운로드)
```

## 모델

| 모델 | 용도 | 크기 | 받기 |
|---|---|---|---|
| Silero VAD | 음성 구간 감지 | 629KB | `npm run download-models` |
| SenseVoice (int8) | 다국어 음성 인식 | 약 230MB | `npm run download-models` |
| M2M100-418M (int8) | 다국어 번역 | 약 630MB | 최초 번역 시 `models/transformers/`로 자동 다운로드 |

## 아키텍처

```
렌더러                                메인 프로세스
마이크 (getUserMedia)
  └─ AudioWorklet로 16kHz PCM 캡처
       └─ IPC ─────────────────────▶ Silero VAD로 발화 분할
                                        └─ SenseVoice 인식 (zh/en/ja/ko/yue)
                                             ├─ 말하는 중 → 부분 인식(실시간)
                                             └─ 구간 종료 → 최종 결과
                                                  └─ M2M100 번역(교체 가능)
       전사 + 번역 ◀──────────────── IPC
```

전사는 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)(ONNX Runtime, 네이티브 N-API 모듈), 번역은 [Transformers.js](https://github.com/huggingface/transformers.js)로 Meta M2M100-418M(MIT)을 실행합니다(역시 onnxruntime 기반). 번역 기능은 `src/translation/`의 `Translator` 인터페이스 뒤에 있어 — 더 강력한 로컬 모델이나 클라우드 API로 교체하려면 구현 하나만 추가하면 됩니다.

## 로드맵

- [ ] 더 높은 품질의 로컬 번역(Qwen2.5 등 LLM 백엔드)
- [ ] 회의록 내보내기(Markdown / SRT)
- [ ] 패키징 배포(electron-builder, 모델은 첫 실행 시 다운로드)
