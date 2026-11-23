// 편집용 JSON 검사: 녹화본을 공식 SDK 스트림에 다시 흘려 메시지를 모으고,
// 모은 한 벌이 공식 검증기를 통과하는지와 부품이 빠지지 않았는지 본다.
// 사용: npx tsx scripts/check-draft.ts
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {createProcessor, validateMessages} from '../server/a2ui.ts';
import {DraftBuilder} from '../src/draft.ts';

const dir = path.resolve(import.meta.dirname, '../recordings');
let checked = 0;
let failed = 0;

for (const file of readdirSync(dir).sort()) {
  const rec = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  if (rec.request.kind === 'text') continue;
  const attempt = rec.attempts[rec.attempts.length - 1];
  if (attempt.error) continue;

  const processor = createProcessor(rec.request.format, rec.request.catalog === 'custom' ? 'custom' : 'basic');
  const stream = processor.openStream({afterRejectedBlock: 'continue'});
  const builder = new DraftBuilder();
  const ids = new Set<string>();
  const collect = (parts: any[]) => {
    for (const part of parts) {
      if (part.type !== 'a2ui') continue;
      builder.add(part.a2ui);
      for (const message of part.a2ui) {
        const type = Object.keys(message).find(key => key !== 'version')!;
        for (const component of message[type].components ?? []) ids.add(component.id);
      }
    }
  };
  for (const delta of attempt.deltas) collect(stream.feed(delta.text));
  collect(stream.close());

  const draft = builder.toMessages();
  const draftIds = new Set<string>();
  for (const message of draft) {
    for (const component of message.updateComponents?.components ?? []) draftIds.add(component.id);
    for (const component of message.createSurface?.components ?? []) draftIds.add(component.id);
  }
  const missing = [...ids].filter(id => !draftIds.has(id));
  const result = validateMessages(draft);
  checked++;
  const label = `${rec.request.format} ${rec.request.catalog ?? 'basic'} ${rec.request.kind} ${String(rec.request.prompt).slice(0, 16)}`;
  if (!result.ok || missing.length > 0) {
    failed++;
    console.log('FAIL', label, result.ok ? '' : result.error, missing.length ? `missing ${missing.join(',')}` : '');
  } else {
    console.log('ok  ', label, `messages ${draft.length}, components ${draftIds.size}`);
  }
}

console.log(`checked ${checked}, failed ${failed}`);
process.exit(failed ? 1 : 0);
