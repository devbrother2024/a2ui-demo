// 공식 에이전트 SDK(@a2ui/agent)로 프롬프트 조각을 만들고 모델 출력을 검증한다.
import path from 'node:path';
import {
  A2uiGenerator,
  type A2uiRequestProcessor,
  CatalogConfig,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  validatePayload,
} from '@a2ui/agent';
import {Catalog} from '@a2ui/web_core';

import {
  DECISION_CATALOG_ID,
  DECISION_CATALOG_INSTRUCTIONS,
  DecisionCardApi,
} from '../shared/decision-card.ts';

export type A2uiFormat = 'json' | 'express';
/** basic: 기본 카탈로그(부품 18종)만. custom: 기본 + 내가 만든 DecisionCard 카탈로그. */
export type CatalogMode = 'basic' | 'custom';

const catalogPath = path.resolve(import.meta.dirname, '../catalog/basic-v1.json');
const basicConfig = CatalogConfig.fromPath(catalogPath);

// 커스텀 카탈로그: 부품의 약속(shared/decision-card.ts)을 그대로 읽어 만든다. JSON 파일을 따로 쓰지 않는다.
const decisionCatalog = new Catalog(
  DECISION_CATALOG_ID,
  '1.0',
  [DecisionCardApi as never],
  [],
  undefined,
  DECISION_CATALOG_INSTRUCTIONS,
);
const decisionConfig = new CatalogConfig(decisionCatalog as never);

const generators: Record<CatalogMode, A2uiGenerator> = {
  basic: new A2uiGenerator([basicConfig]),
  custom: new A2uiGenerator([basicConfig, decisionConfig]),
};

export const catalogId = basicConfig.catalog.id;
export const customCatalogId = DECISION_CATALOG_ID;

function catalogIds(mode: CatalogMode): string[] {
  return mode === 'custom' ? [catalogId, DECISION_CATALOG_ID] : [catalogId];
}

export function createProcessor(format: A2uiFormat, mode: CatalogMode = 'basic'): A2uiRequestProcessor {
  const factory =
    format === 'express'
      ? new ExpressFormatFactory({surfaceId: 'default'})
      : new DirectJsonFormatFactory();
  return generators[mode].createProcessor({supportedCatalogIds: catalogIds(mode)}, factory);
}

const ROLE = `You are an assistant inside a demo app that renders A2UI.
Answer every request with ONE A2UI surface (cards, lists, tabs, forms, buttons) instead of prose.
Rules for this app:
- Write all user-visible text in Korean.
- Do not write prose before or after the A2UI block. The UI is the whole answer.
- When you need information from the user, build a real form: TextField, ChoicePicker, DateTimeInput, Slider or CheckBox bound to the data model, and a Button whose action is an event that carries the bound values in its context.
- When you list options the user could pick, give each option a Button whose action is an event with the option's name in its context.
- Keep it compact: at most about 25 components.
- Do not use Image, Video or AudioPlayer (the demo has no media).
- Use a new, unique surfaceId on every turn.
- Write exactly one A2UI block that holds the whole surface. The app already draws it step by step while you write, so do not split it into several blocks.`;

const DIRECT_JSON_ORDER = `
- Inside that one block, order the messages like this: a createSurface with no components, then one updateComponents that lists every component starting with root, then updateDataModel when you use bindings.`;

// 실측에서 걸린 두 가지를 규칙으로 적었다.
// 1) action의 context 값에 null을 넣으면 검증에서 걸린다. 2) Express에서는 카탈로그가 여럿일 때 surface에 카탈로그 이름을 적으면 걸린다.
const CUSTOM_CATALOG_RULE = `
- This app also has its own catalog with a DecisionCard component. When the user must choose between options, use one DecisionCard as the root of the surface instead of composing Cards and Buttons. For everything else use the basic catalog.
- In every action context, use only strings, numbers or booleans. Never write null: leave the key out instead.`;

const CUSTOM_CATALOG_JSON_RULE = `
- A surface whose root is a DecisionCard must be created with that catalog's catalogId.`;

export function buildSystemPrompt(
  format: A2uiFormat,
  processor: A2uiRequestProcessor,
  mode: CatalogMode = 'basic',
): string {
  let role = format === 'json' ? ROLE + DIRECT_JSON_ORDER : ROLE;
  if (mode === 'custom') role += CUSTOM_CATALOG_RULE + (format === 'json' ? CUSTOM_CATALOG_JSON_RULE : '');
  return [role, processor.promptSnippet].join('\n\n');
}

export const TEXT_SYSTEM_PROMPT = `You are a helpful assistant in a chat app. Answer in Korean, in Markdown, the way a normal text chatbot would. When you need information from the user, ask for it in text.`;

export function snippetSizes(): Record<string, number> {
  return {
    json: createProcessor('json').promptSnippet.length,
    express: createProcessor('express').promptSnippet.length,
    'json+custom': createProcessor('json', 'custom').promptSnippet.length,
    'express+custom': createProcessor('express', 'custom').promptSnippet.length,
  };
}

/** 사람이 손으로 고친 메시지 배열을 렌더러가 받아 줄지 검사한다. 두 카탈로그를 모두 안다. */
export function validateMessages(messages: unknown): {ok: true} | {ok: false; error: string} {
  try {
    validatePayload([basicConfig.catalog, decisionCatalog as never], messages as never);
    return {ok: true};
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}
