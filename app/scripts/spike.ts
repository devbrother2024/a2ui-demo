// 공식 에이전트 SDK가 만들어 주는 프롬프트 조각 크기와, claude -p 한 번 호출이 통과하는지 보는 시험.
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  A2uiGenerator,
  CatalogConfig,
  DirectJsonFormatFactory,
  ExpressFormatFactory,
} from '@a2ui/agent';

const catalogPath = path.resolve(import.meta.dirname, '../catalog/basic-v1.json');
const config = CatalogConfig.fromPath(catalogPath);
const generator = new A2uiGenerator([config]);
const catalogId = config.catalog.id;
console.log('catalog id:', catalogId);

const direct = generator.createProcessor({supportedCatalogIds: [catalogId]}, new DirectJsonFormatFactory());
const express = generator.createProcessor(
  {supportedCatalogIds: [catalogId]},
  new ExpressFormatFactory({surfaceId: 'default'}),
);
console.log('direct snippet chars:', direct.promptSnippet.length, 'streaming:', direct.parser.supportsStreaming);
console.log('express snippet chars:', express.promptSnippet.length, 'streaming:', express.parser.supportsStreaming);

const which = process.argv[2] ?? 'direct';
const model = process.argv[3] ?? 'sonnet';
const processor = which === 'express' ? express : direct;
if (process.argv.includes('--print-snippet')) {
  console.log(processor.promptSnippet);
  process.exit(0);
}

const system = [
  'You are a travel assistant inside a demo app. Answer the user by generating an A2UI interface (cards, lists, forms, buttons) instead of prose. Write all visible text in Korean. Keep it to one surface.',
  processor.promptSnippet,
].join('\n\n');
const cwd = mkdtempSync(path.join(tmpdir(), 'a2ui-spike-'));
const started = Date.now();
const out = spawnSync(
  'claude',
  [
    '-p',
    '--restricted',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--system-prompt',
    system,
    '--model',
    model,
    '--output-format',
    'json',
  ],
  {cwd, input: '이번 주말 제주도 1박 2일 일정을 짜 줘. 숙소 후보 3곳도 골라 줘.', encoding: 'utf8', maxBuffer: 1 << 26},
);
console.log('exit', out.status, 'ms', Date.now() - started);
if (out.status !== 0) {
  console.log(out.stderr.slice(0, 2000));
  process.exit(1);
}
const result = JSON.parse(out.stdout);
console.log('usage', JSON.stringify(result.usage ?? {}).slice(0, 400));
const text: string = result.result;
console.log('--- model text (first 1500) ---\n' + text.slice(0, 1500));
try {
  const parts = processor.parseResponse(text);
  for (const part of parts) {
    if (part.type === 'text') console.log('TEXT part:', part.text.slice(0, 200));
    else console.log('A2UI part:', JSON.stringify(part.a2ui).length, 'chars,', part.a2ui.length, 'messages');
  }
} catch (e) {
  console.log('PARSE ERROR', e);
}
