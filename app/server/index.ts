// A2UI 나란히 보기 데모 서버.
// 같은 질문을 (1) 평범한 텍스트 챗봇 (2) A2UI 에이전트에 보내고, 모델이 쓰는 글자를 그대로 브라우저로 흘려보낸다.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import http, {type IncomingMessage, type ServerResponse} from 'node:http';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';

import {
  type A2uiFormat,
  buildSystemPrompt,
  catalogId,
  type CatalogMode,
  customCatalogId,
  createProcessor,
  snippetSizes,
  TEXT_SYSTEM_PROMPT,
  validateMessages,
} from './a2ui.ts';
import {EFFORT, MODEL, streamClaude, type TurnUsage} from './llm.ts';

const PORT = Number(process.env.PORT ?? 5273);
const HOST = process.env.HOST ?? '0.0.0.0';
const root = path.resolve(import.meta.dirname, '..');
const recordingsDir = path.join(root, 'recordings');
mkdirSync(recordingsDir, {recursive: true});

type TurnKind = 'text' | 'a2ui' | 'action';

interface TurnRequest {
  kind: TurnKind;
  format: A2uiFormat;
  /** 쓸 부품 목록. 없으면 기본 카탈로그만. */
  catalog?: CatalogMode;
  /** 사용자가 처음 친 질문. action 차례에서도 같은 값을 보낸다. */
  prompt: string;
  /** action 차례: 렌더러가 보낸 A2UI action 메시지. */
  action?: {name: string; [key: string]: unknown};
  /** action 차례: 그 순간 화면의 데이터 모델. */
  dataModel?: unknown;
  /** action 차례: 직전에 에이전트가 썼던 원문. */
  previous?: string;
  source: 'live' | 'replay';
  /** 실측 스크립트용: 응답을 녹화본으로 저장하지 않는다(촬영용 녹화본을 덮어쓰지 않게). */
  noRecord?: boolean;
}

interface Recording {
  key: string;
  request: Omit<TurnRequest, 'source'>;
  model: string;
  recordedAt: string;
  ms: number;
  usage: TurnUsage;
  attempts: {deltas: {t: number; text: string}[]; error?: string}[];
}

function recordingKey(req: TurnRequest): string {
  // 기본 카탈로그의 키는 예전 그대로 둔다(이미 있는 녹화본을 계속 쓰기 위해).
  const mode = req.catalog === 'custom' ? '|custom' : '';
  if (req.kind === 'text') return `text|${req.prompt}`;
  if (req.kind === 'a2ui') return `a2ui|${req.format}|${req.prompt}${mode}`;
  return `action|${req.format}|${req.prompt}|${req.action?.name ?? ''}${mode}`;
}

function recordingPath(key: string): string {
  return path.join(recordingsDir, createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json');
}

function loadRecording(key: string): Recording | undefined {
  const file = recordingPath(key);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as Recording;
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function buildActionInput(req: TurnRequest): string {
  return [
    `The user first asked: ${req.prompt}`,
    `You answered with this A2UI:\n${req.previous ?? '(not available)'}`,
    `The user then interacted with that UI. The renderer sent this A2UI action message:\n${JSON.stringify(req.action, null, 2)}`,
    `The surface's data model at that moment:\n${JSON.stringify(req.dataModel ?? {}, null, 2)}`,
    'Respond to the action with a new surface (new surfaceId). If the user submitted a form, show a confirmation card that repeats what they entered.',
  ].join('\n\n');
}

async function handleTurn(req: IncomingMessage, res: ServerResponse) {
  const body = (await readBody(req)) as TurnRequest;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const key = recordingKey(body);
  const recording = body.source === 'replay' ? loadRecording(key) : undefined;
  const source = recording ? 'replay' : 'live';
  send('start', {source, model: recording?.model ?? MODEL, kind: body.kind, format: body.format});

  const isA2ui = body.kind !== 'text';
  const mode: CatalogMode = body.catalog === 'custom' ? 'custom' : 'basic';
  const processor = isA2ui ? createProcessor(body.format, mode) : undefined;
  const system = processor ? buildSystemPrompt(body.format, processor, mode) : TEXT_SYSTEM_PROMPT;
  const baseInput = body.kind === 'action' ? buildActionInput(body) : body.prompt;

  const started = Date.now();
  const attempts: Recording['attempts'] = [];
  let usage: TurnUsage = {inputTokens: 0, outputTokens: 0, thinkingTokens: 0};
  const maxAttempts = isA2ui ? 2 : 1;

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const recorded = recording?.attempts[attempt];
      if (recording && !recorded) break;
      if (attempt > 0) send('retry', {attempt: attempt + 1, reason: attempts[attempt - 1]?.error});

      const stream = processor?.openStream({afterRejectedBlock: 'continue'});
      const deltas: {t: number; text: string}[] = [];
      let surfaces = 0;
      let rejected: string | undefined;
      const attemptStart = Date.now();

      const emitParts = (parts: ReturnType<NonNullable<typeof stream>['feed']>) => {
        for (const part of parts) {
          if (part.type === 'a2ui') {
            surfaces += part.a2ui.length;
            send('a2ui', {messages: part.a2ui});
          } else if (part.type === 'error') {
            rejected = part.error.message;
            send('rejected', {message: part.error.message});
          }
        }
      };
      const onDelta = (text: string) => {
        deltas.push({t: Date.now() - attemptStart, text});
        send('delta', {text});
        if (stream) {
          try {
            emitParts(stream.feed(text));
          } catch (e) {
            rejected = e instanceof Error ? e.message : String(e);
            send('rejected', {message: rejected});
          }
        }
      };

      if (recorded) {
        let last = 0;
        for (const delta of recorded.deltas) {
          if (abort.signal.aborted) return;
          await sleep(Math.min(delta.t - last, 4000));
          last = delta.t;
          onDelta(delta.text);
        }
      } else {
        const retryNote =
          attempt > 0
            ? `\n\nYour previous answer was rejected by the A2UI validator with this error:\n${attempts[attempt - 1]?.error}\nWrite the whole answer again and fix it.`
            : '';
        const result = await streamClaude(system, baseInput + retryNote, onDelta, abort.signal);
        usage = {
          inputTokens: usage.inputTokens + result.usage.inputTokens,
          outputTokens: usage.outputTokens + result.usage.outputTokens,
          thinkingTokens: usage.thinkingTokens + result.usage.thinkingTokens,
        };
      }
      if (stream) {
        try {
          emitParts(stream.close());
        } catch (e) {
          rejected = e instanceof Error ? e.message : String(e);
          send('rejected', {message: rejected});
        }
        if (!rejected && surfaces === 0) rejected = 'The answer contained no A2UI block.';
      }
      attempts.push({deltas, error: rejected});
      if (!rejected) break;
    }

    const ms = recording ? recording.ms : Date.now() - started;
    if (recording) usage = recording.usage;
    else if (!body.noRecord) {
      const saved: Recording = {
        key,
        request: {kind: body.kind, format: body.format, catalog: body.catalog, prompt: body.prompt, action: body.action},
        model: MODEL,
        recordedAt: new Date().toISOString(),
        ms,
        usage,
        attempts,
      };
      writeFileSync(recordingPath(key), JSON.stringify(saved));
    }
    const lastAttempt = attempts[attempts.length - 1];
    send('done', {
      source,
      ms,
      usage,
      attempts: attempts.length,
      failed: Boolean(isA2ui && lastAttempt?.error),
      chars: lastAttempt?.deltas.reduce((sum, d) => sum + d.text.length, 0) ?? 0,
    });
  } catch (e) {
    send('failure', {message: e instanceof Error ? e.message : String(e)});
  } finally {
    res.end();
  }
}

const vite = await createViteServer({
  root,
  server: {middlewareMode: true, host: HOST, allowedHosts: true},
  appType: 'spa',
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/turn') return await handleTurn(req, res);
    if (req.method === 'POST' && req.url === '/api/validate') {
      const body = await readBody(req);
      return sendJson(res, 200, validateMessages(body.messages));
    }
    if (req.method === 'GET' && req.url === '/api/info') {
      return sendJson(res, 200, {
        model: MODEL,
        effort: EFFORT,
        catalogId,
        customCatalogId,
        snippetChars: snippetSizes(),
        recordings: readdirSync(recordingsDir).filter(name => name.endsWith('.json')).length,
      });
    }
  } catch (e) {
    return sendJson(res, 500, {error: e instanceof Error ? e.message : String(e)});
  }
  vite.middlewares(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`A2UI 데모: http://${HOST}:${PORT}  (모델 ${MODEL}, effort ${EFFORT})`);
});
