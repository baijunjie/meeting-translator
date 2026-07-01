<script lang="ts">
import type {
  UiLang,
  FontSize,
  ThemePref,
  CloudTranslationConfig,
  TranslationEngine,
} from '@rt/core';

/**
 * 翻译方式的三态选择（UI 概念，不进持久化）：
 *  · 'none'          → 关闭翻译（取代旧的独立翻译开关）
 *  · 'm2m100'/'cloud' → 选中即开启翻译并用对应引擎
 * 与持久化的 { enabled, engine } 的映射在各调用页完成（enabled = 选择 !== 'none'）。
 */
export type TranslationChoice = 'none' | TranslationEngine;

/** 设置表单的数据形状（设置页与首次引导向导共用） */
export interface SettingsFormData {
  nativeLang: UiLang;
  fontSize: FontSize;
  theme: ThemePref;
  engine: TranslationChoice;
  cloud: CloudTranslationConfig;
}
</script>

<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';
import { NSelect, NInput, NFormItem, NAlert, NButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { bridge } from '../bridge';
import { previewLocale, previewTheme, applyFontSize } from '../composables/useSettings';

const { t } = useI18n();
// 父组件持有 reactive 表单对象，子组件直接通过 v-model 修改其字段
const props = defineProps<{
  form: SettingsFormData;
  /** 是否要求「有改动」才允许保存：设置页传 true（没改动就禁用保存）；引导页省略（用默认也可开始）。 */
  requireDirty?: boolean;
}>();

// 平台是否支持本地翻译引擎（Web 在 iOS 上为 false：WebKit 内存装不下本地模型）。
// 不可用时仅从「翻译方式」下拉里去掉「本地」项（仍保留 无 / 云端）。iOS 上持久化的 engine
// 也已被 bridge 收敛为 cloud（applyPlatformConstraints），故表单不会停在无法选中的本地项。
const localTranslationAvailable = bridge().localTranslationAvailable !== false;

// —— 云端连接测试 + 保存门禁 ——
// saveable 回传父组件（设置页/引导页据此禁用「保存/开始」）：非云端恒可存；云端需测试通过。
const saveable = defineModel<boolean>('saveable', { default: true });

// 平台是否支持云端测试：Web / iOS 用 JS fetch 实现；macOS 云翻译在独立进程、未提供本方法
// → 不显示测试按钮、也不阻断保存（沿用旧行为）。
const canTestCloud = typeof bridge().testCloud === 'function';
type CloudTestState = 'idle' | 'testing' | 'ok' | 'error';
const cloudTest = ref<CloudTestState>('idle');
const cloudTestError = ref('');

// 云端三项必填齐全才允许测试。
const cloudFilled = computed(
  () =>
    props.form.cloud.baseURL.trim() !== '' &&
    props.form.cloud.apiKey.trim() !== '' &&
    props.form.cloud.model.trim() !== '',
);
const canTest = computed(() => cloudFilled.value && cloudTest.value !== 'testing');

async function runCloudTest(): Promise<void> {
  if (!canTest.value) return;
  cloudTest.value = 'testing';
  cloudTestError.value = '';
  const r = await bridge().testCloud!({ ...props.form.cloud });
  cloudTest.value = r.ok ? 'ok' : 'error';
  if (!r.ok) cloudTestError.value = r.error ?? '';
}

// 引擎或任一云端字段变化 → 作废上次测试结果（避免测通后又改坏却仍能保存）。
watch(
  [
    () => props.form.engine,
    () => props.form.cloud.baseURL,
    () => props.form.cloud.apiKey,
    () => props.form.cloud.model,
  ],
  () => {
    cloudTest.value = 'idle';
    cloudTestError.value = '';
  },
);

// 打开时的整表单快照，用于两处判断：
//  · dirty：表单较打开时是否有任何改动（设置页据此禁用「保存」——没改动就无可保存）。
//  · cloudUnchanged：云端配置（引擎 + 三项）是否与打开时一致——一致说明此前已保存/已验证，
//    本次只改了语言等其它设置时不必重新测试连接。
const initialJson = JSON.stringify(props.form);
const initial = JSON.parse(initialJson) as SettingsFormData;
const dirty = computed(() => JSON.stringify(props.form) !== initialJson);
const cloudUnchanged = computed(
  () =>
    props.form.engine === initial.engine &&
    props.form.cloud.baseURL === initial.cloud.baseURL &&
    props.form.cloud.apiKey === initial.cloud.apiKey &&
    props.form.cloud.model === initial.cloud.model,
);
// 云端视为已验证：本次测试通过，或配置与打开时一致（此前保存过、未改动）。
const cloudVerified = computed(() => cloudTest.value === 'ok' || cloudUnchanged.value);

// 云端门禁：非云端恒可；平台不支持测试（macOS）不阻断；云端须已验证（本次测通或未改动的旧配置）。
const cloudOk = computed(
  () => props.form.engine !== 'cloud' || !canTestCloud || cloudVerified.value,
);
// 保存门禁：云端门禁通过，且（当 requireDirty 时）表单确有改动才可保存。
// 设置页 requireDirty=true → 没改动禁用「保存」；引导页省略 → 用默认也可「开始」。
watchEffect(() => {
  saveable.value = cloudOk.value && (!props.requireDirty || dirty.value);
});

// 按语言 key 字母序排列
const langOptions = [
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: '简体中文', value: 'zh' },
  { label: '繁體中文', value: 'zh-Hant' },
];
const fontOptions = computed(() => [
  { label: t('settings.fontSmall'), value: 'small' },
  { label: t('settings.fontMedium'), value: 'medium' },
  { label: t('settings.fontLarge'), value: 'large' },
]);
const themeOptions = computed(() => [
  { label: t('main.themeLight'), value: 'light' },
  { label: t('main.themeDark'), value: 'dark' },
  { label: t('main.themeSystem'), value: 'system' },
]);
// 三态：无 / 本地（仅本地引擎可用时）/ 云端。选中模型即开启翻译，选「无」即关闭。
const engineOptions = computed(() => [
  { label: t('settings.engineNone'), value: 'none' },
  ...(localTranslationAvailable ? [{ label: t('settings.engineM2m100'), value: 'm2m100' }] : []),
  { label: t('settings.engineCloud'), value: 'cloud' },
]);

// 改动即时预览界面语言 / 主题 / 字体
watch(() => props.form.nativeLang, (v) => previewLocale(v));
watch(() => props.form.theme, (v) => previewTheme(v));
watch(() => props.form.fontSize, (v) => applyFontSize(v));
</script>

<template>
  <div>
    <n-form-item :label="t('settings.nativeLang')">
      <n-select v-model:value="form.nativeLang" :options="langOptions" />
    </n-form-item>

    <n-form-item :label="t('settings.fontSize')">
      <n-select v-model:value="form.fontSize" :options="fontOptions" />
    </n-form-item>

    <n-form-item :label="t('main.theme')">
      <n-select v-model:value="form.theme" :options="themeOptions" />
    </n-form-item>

    <n-form-item :label="t('settings.engine')">
      <n-select v-model:value="form.engine" :options="engineOptions" />
    </n-form-item>

    <template v-if="form.engine === 'cloud'">
      <n-alert type="warning" :show-icon="true" class="mb-3.5">{{ t('settings.cloudWarn') }}</n-alert>
      <n-form-item :label="t('settings.baseUrl')">
        <n-input v-model:value="form.cloud.baseURL" placeholder="https://api.openai.com/v1" />
      </n-form-item>
      <n-form-item :label="t('settings.model')">
        <n-input v-model:value="form.cloud.model" placeholder="gpt-4o-mini" />
      </n-form-item>
      <n-form-item :label="t('settings.apiKey')">
        <n-input v-model:value="form.cloud.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
      </n-form-item>
      <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.cloudHint') }}</p>

      <!-- 平台支持时才有测试：必填齐全才可点击；测试通过后父组件才允许保存 -->
      <template v-if="canTestCloud">
        <div class="mt-3 flex items-center gap-3">
          <n-button
            size="small"
            :disabled="!canTest"
            :loading="cloudTest === 'testing'"
            @click="runCloudTest"
          >
            {{ cloudTest === 'testing' ? t('settings.testing') : t('settings.testConn') }}
          </n-button>
          <span
            v-if="cloudTest === 'ok'"
            class="text-xs font-medium text-green-600 dark:text-green-400"
          >✓ {{ t('settings.testOk') }}</span>
          <span
            v-else-if="cloudTest === 'error'"
            class="text-xs font-medium text-red-600 dark:text-red-400"
          >{{ t('settings.testFail') }}</span>
          <span
            v-else-if="cloudTest === 'idle' && cloudFilled && !cloudUnchanged"
            class="text-xs text-neutral-500 dark:text-neutral-400"
          >{{ t('settings.testHint') }}</span>
        </div>
        <p
          v-if="cloudTest === 'error' && cloudTestError"
          class="mt-1 break-words text-xs text-red-500 dark:text-red-400"
        >{{ cloudTestError }}</p>
      </template>
    </template>
  </div>
</template>
