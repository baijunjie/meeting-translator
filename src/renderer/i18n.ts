// 界面文案多语言。本文件是「经典脚本」（无 import/export），编译成 i18n.js，
// 在 index.html 里先于 renderer.js 引入，二者共享全局作用域。

// 母语/界面语言的自称名（与当前界面语言无关）
const LANG_NAMES: Record<UiLang, string> = {
  zh: '中文',
  ja: '日本語',
  en: 'English',
  ko: '한국어',
};

const I18N: Record<UiLang, Record<string, string>> = {
  zh: {
    'onboarding.title': '欢迎使用 Meeting Translator',
    'onboarding.subtitle': '请选择你的语言',
    'main.start': '开始录音',
    'main.stop': '停止录音',
    'main.translate': '翻译',
    'main.settingsTitle': '设置',
    'main.emptyHint': '点击「开始录音」，识别结果会显示在这里',
    'status.ready': '就绪',
    'status.loadingModel': '加载模型中…',
    'status.recording': '● 录音中',
    'status.stopped': '已停止',
    'status.errorPrefix': '出错: ',
    'status.transLoading': '翻译模型加载中…',
    'status.transFailed': '翻译模型加载失败',
    'settings.title': '设置',
    'settings.back': '返回',
    'settings.save': '保存',
    'settings.nativeLang': '母语',
    'settings.fontSize': '字体大小',
    'settings.fontSmall': '小',
    'settings.fontMedium': '中',
    'settings.fontLarge': '大',
    'settings.engine': '翻译方式',
    'settings.engineLocal': '本地（M2M100，离线）',
    'settings.engineCloud': '云端（OpenAI 兼容）',
    'settings.cloudWarn': '⚠ 云端翻译会把会议文本发送到第三方服务，请确认合规后再使用。',
    'settings.baseUrl': 'Base URL',
    'settings.apiKey': 'API Key',
    'settings.model': '模型',
    'settings.cloudHint': '密钥仅保存在本机。兼容任何 OpenAI 格式端点（官方 / 代理 / 本地）。',
  },
  ja: {
    'onboarding.title': 'Meeting Translator へようこそ',
    'onboarding.subtitle': '言語を選択してください',
    'main.start': '録音開始',
    'main.stop': '録音停止',
    'main.translate': '翻訳',
    'main.settingsTitle': '設定',
    'main.emptyHint': '「録音開始」をクリックすると、認識結果がここに表示されます',
    'status.ready': '準備完了',
    'status.loadingModel': 'モデルを読み込み中…',
    'status.recording': '● 録音中',
    'status.stopped': '停止しました',
    'status.errorPrefix': 'エラー: ',
    'status.transLoading': '翻訳モデルを読み込み中…',
    'status.transFailed': '翻訳モデルの読み込みに失敗しました',
    'settings.title': '設定',
    'settings.back': '戻る',
    'settings.save': '保存',
    'settings.nativeLang': '母語',
    'settings.fontSize': '文字サイズ',
    'settings.fontSmall': '小',
    'settings.fontMedium': '中',
    'settings.fontLarge': '大',
    'settings.engine': '翻訳方式',
    'settings.engineLocal': 'ローカル（M2M100、オフライン）',
    'settings.engineCloud': 'クラウド（OpenAI 互換）',
    'settings.cloudWarn': '⚠ クラウド翻訳は会議のテキストを第三者サービスに送信します。コンプライアンスを確認のうえご利用ください。',
    'settings.baseUrl': 'Base URL',
    'settings.apiKey': 'API Key',
    'settings.model': 'モデル',
    'settings.cloudHint': 'キーはこの端末にのみ保存されます。OpenAI 形式の任意のエンドポイント（公式 / プロキシ / ローカル）に対応。',
  },
  en: {
    'onboarding.title': 'Welcome to Meeting Translator',
    'onboarding.subtitle': 'Choose your language',
    'main.start': 'Start Recording',
    'main.stop': 'Stop Recording',
    'main.translate': 'Translate',
    'main.settingsTitle': 'Settings',
    'main.emptyHint': 'Click “Start Recording” and results will appear here',
    'status.ready': 'Ready',
    'status.loadingModel': 'Loading model…',
    'status.recording': '● Recording',
    'status.stopped': 'Stopped',
    'status.errorPrefix': 'Error: ',
    'status.transLoading': 'Loading translation model…',
    'status.transFailed': 'Failed to load translation model',
    'settings.title': 'Settings',
    'settings.back': 'Back',
    'settings.save': 'Save',
    'settings.nativeLang': 'Language',
    'settings.fontSize': 'Font size',
    'settings.fontSmall': 'Small',
    'settings.fontMedium': 'Medium',
    'settings.fontLarge': 'Large',
    'settings.engine': 'Translation',
    'settings.engineLocal': 'Local (M2M100, offline)',
    'settings.engineCloud': 'Cloud (OpenAI-compatible)',
    'settings.cloudWarn': '⚠ Cloud translation sends meeting text to a third-party service. Make sure this is compliant before enabling.',
    'settings.baseUrl': 'Base URL',
    'settings.apiKey': 'API Key',
    'settings.model': 'Model',
    'settings.cloudHint': 'The key is stored only on this device. Works with any OpenAI-compatible endpoint (official / proxy / local).',
  },
  ko: {
    'onboarding.title': 'Meeting Translator에 오신 것을 환영합니다',
    'onboarding.subtitle': '언어를 선택하세요',
    'main.start': '녹음 시작',
    'main.stop': '녹음 중지',
    'main.translate': '번역',
    'main.settingsTitle': '설정',
    'main.emptyHint': '「녹음 시작」을 누르면 인식 결과가 여기에 표시됩니다',
    'status.ready': '준비됨',
    'status.loadingModel': '모델 로딩 중…',
    'status.recording': '● 녹음 중',
    'status.stopped': '중지됨',
    'status.errorPrefix': '오류: ',
    'status.transLoading': '번역 모델 로딩 중…',
    'status.transFailed': '번역 모델 로딩 실패',
    'settings.title': '설정',
    'settings.back': '뒤로',
    'settings.save': '저장',
    'settings.nativeLang': '모국어',
    'settings.fontSize': '글자 크기',
    'settings.fontSmall': '작게',
    'settings.fontMedium': '보통',
    'settings.fontLarge': '크게',
    'settings.engine': '번역 방식',
    'settings.engineLocal': '로컬 (M2M100, 오프라인)',
    'settings.engineCloud': '클라우드 (OpenAI 호환)',
    'settings.cloudWarn': '⚠ 클라우드 번역은 회의 텍스트를 제3자 서비스로 전송합니다. 규정을 확인한 후 사용하세요.',
    'settings.baseUrl': 'Base URL',
    'settings.apiKey': 'API Key',
    'settings.model': '모델',
    'settings.cloudHint': '키는 이 기기에만 저장됩니다. OpenAI 형식의 모든 엔드포인트(공식 / 프록시 / 로컬)와 호환됩니다.',
  },
};

let currentLocale: UiLang = 'en';

function t(key: string): string {
  return I18N[currentLocale]?.[key] ?? I18N.en[key] ?? key;
}

/** 把当前语言应用到所有带 data-i18n* 标注的元素 */
function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as string);
  });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh as string);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as string);
  });
}

function setLocale(lang: UiLang): void {
  currentLocale = lang;
  document.documentElement.lang = lang;
  applyI18n();
}
