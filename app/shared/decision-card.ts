// 커스텀 부품 DecisionCard의 약속(이름과 속성). 에이전트 쪽과 화면 쪽이 이 파일 하나를 같이 쓴다.
// 결정 카드 모양: 질문, 이유, 선택지마다 하는 일·장점·단점·추천.
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v1_0';

export const DECISION_CATALOG_ID = 'https://devbrothers.ai/a2ui/catalogs/decision/v1/catalog.json';

export const DecisionCardApi = {
  name: 'DecisionCard',
  schema: z
    .object({
      title: CommonSchemas.DynamicString.describe('Short title of the decision.'),
      ask: CommonSchemas.DynamicString.describe('What the user must decide, in one or two sentences.'),
      why: CommonSchemas.DynamicString.optional().describe('Why the agent needs this decision now.'),
      options: z
        .array(
          z.object({
            label: CommonSchemas.DynamicString.describe('Name of the option.'),
            does: CommonSchemas.DynamicString.describe('What the agent will do if the user picks this option.'),
            pros: CommonSchemas.DynamicString.optional().describe('Upside, one sentence.'),
            cons: CommonSchemas.DynamicString.optional().describe('Downside, one sentence.'),
            recommended: z.boolean().optional().describe('True for the single option the agent recommends.'),
            action: CommonSchemas.Action.describe('Event sent to the agent when the user picks this option. Put the option name in its context.'),
          }),
        )
        .min(2)
        .max(5)
        .describe('The choices. Exactly one may be recommended.'),
    })
    .describe(
      'A decision request from an agent to its human supervisor: the question, the reason, and two to five options each with what happens next, pros, cons and a pick button. Use this instead of composing Cards and Buttons whenever the agent needs the user to choose between options.',
    ),
};

export const DECISION_CATALOG_INSTRUCTIONS =
  'When the user must choose between options, answer with a single DecisionCard as the root of the surface. Do not rebuild the same layout from Card, Column, Text and Button.';
