// 녹화본을 공식 SDK 스트림에 다시 흘려, 형식별로 어떤 메시지가 나오는지 본다.
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {createProcessor} from '../server/a2ui.ts';

const dir = path.resolve(import.meta.dirname, '../recordings');
for (const file of readdirSync(dir)) {
  const rec = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  if (rec.request.kind === 'text') continue;
  const processor = createProcessor(rec.request.format, rec.request.catalog === 'custom' ? 'custom' : 'basic');
  const stream = processor.openStream({afterRejectedBlock: 'continue'});
  const attempt = rec.attempts[rec.attempts.length - 1];
  const seen: string[] = [];
  const emit = (parts: any[]) => {
    for (const part of parts) {
      if (part.type !== 'a2ui') continue;
      for (const message of part.a2ui) {
        const type = Object.keys(message).find(k => k !== 'version')!;
        const ids = (message[type].components ?? []).map((c: any) => c.id);
        seen.push(`${type}(${ids.length}${message[type].path ? ' path=' + message[type].path : ''})`);
      }
    }
  };
  for (const delta of attempt.deltas) emit(stream.feed(delta.text));
  emit(stream.close());
  console.log(rec.request.format, rec.request.kind, rec.request.prompt.slice(0, 14), '=>', seen.slice(0, 14).join(' '), seen.length > 14 ? `... (${seen.length})` : '');
}
