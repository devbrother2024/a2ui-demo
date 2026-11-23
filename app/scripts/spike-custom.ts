// 커스텀 카탈로그 시험: 기본 카탈로그와 DecisionCard 카탈로그를 함께 주고 프롬프트 조각을 본다.
import path from 'node:path';
import {A2uiGenerator, CatalogConfig, DirectJsonFormatFactory} from '@a2ui/agent';
import {Catalog} from '@a2ui/web_core';
import {DECISION_CATALOG_ID, DECISION_CATALOG_INSTRUCTIONS, DecisionCardApi} from '../shared/decision-card.ts';

const basic = CatalogConfig.fromPath(path.resolve(import.meta.dirname, '../catalog/basic-v1.json'));
const decision = new Catalog(DECISION_CATALOG_ID, '1.0', [DecisionCardApi as never], [], undefined, DECISION_CATALOG_INSTRUCTIONS);
console.log('decision catalog json keys:', Object.keys(decision.toJson()));
const generator = new A2uiGenerator([basic, new CatalogConfig(decision as never)]);
const processor = generator.createProcessor(
  {supportedCatalogIds: [basic.catalog.id, DECISION_CATALOG_ID]},
  new DirectJsonFormatFactory(),
);
const snippet = processor.promptSnippet;
console.log('snippet chars', snippet.length);
const i = snippet.indexOf('DecisionCard');
console.log(snippet.slice(Math.max(0, i - 600), i + 1800));
for (const kw of ['@catalogId', 'multiple catalogs', 'catalogId']) {
  const k = snippet.indexOf(kw);
  console.log('---', kw, k >= 0 ? snippet.slice(Math.max(0, k - 200), k + 400).replace(/\n/g, ' ') : 'NOT FOUND');
}

// 실제로 모델에게 결정 요청을 쓰게 해 본다.
import {streamClaude} from '../server/llm.ts';
const system = [
  'You are an assistant inside a demo app that renders A2UI. Answer with ONE A2UI surface instead of prose. Write all user-visible text in Korean. Use a new, unique surfaceId. Write exactly one A2UI block.',
  snippet,
].join('\n\n');
const prompt = '너는 영상 편집을 맡은 작업 에이전트야. 자막이 음성보다 0.12초 늦는 걸 발견했어. 내 결정이 필요하니 나한테 물어봐 줘. 선택지는 전체 0.10초 당기기, 전체 0.15초 당기기, 구간별 수동 보정이고 네 추천은 0.10초야. 선택지마다 장단점과, 내가 고르면 네가 할 일을 알려 줘.';
const started = Date.now();
const result = await streamClaude(system, prompt, () => {});
console.log('ms', Date.now() - started, 'usage', JSON.stringify(result.usage));
console.log(result.text.slice(0, 2600));
try {
  const parts = processor.parseResponse(result.text);
  for (const part of parts) {
    if (part.type === 'a2ui') console.log('VALID a2ui messages:', part.a2ui.length, JSON.stringify(part.a2ui).includes('DecisionCard') ? 'uses DecisionCard' : 'NO DecisionCard');
  }
} catch (e) {
  console.log('PARSE ERROR', e instanceof Error ? e.message : e);
}
