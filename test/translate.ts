// 离线验证翻译：多向互译 + 语言码映射（手动冒烟脚本，非自动化测试）
//   npm run test-translate
import path from 'node:path';
import { createTranslator } from '../src/translation/translator';

const cases = [
  { text: '今天我们讨论新产品的发布计划。', source: 'zh', target: 'ja' },
  { text: '来月の15日はどうでしょうか？', source: 'ja', target: 'zh' },
  { text: 'Let us look at the schedule first.', source: 'en', target: 'zh' },
  { text: '안녕하세요 여러분', source: 'ko', target: 'en' },
  { text: '同语言应直接返回原文', source: 'zh', target: 'zh' },
];

async function main(): Promise<void> {
  const cacheDir = path.join(__dirname, '..', '..', 'models', 'transformers');
  const translator = createTranslator({ backend: 'm2m100', cacheDir });

  console.log('加载翻译模型（首次会从 HuggingFace 下载约 630MB）...');
  const t0 = Date.now();
  await translator.init((p) => {
    if (p.status !== 'progress') {
      console.log('  ', p.status, p.file ?? '');
    }
  });
  console.log(`模型就绪 (${Date.now() - t0}ms)\n`);

  for (const c of cases) {
    const t1 = Date.now();
    const out = await translator.translate(c.text, { source: c.source, target: c.target });
    console.log(`[${c.source}->${c.target}] ${c.text}\n   => ${out}  (${Date.now() - t1}ms)\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
