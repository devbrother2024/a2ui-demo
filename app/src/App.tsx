import {type FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {A2uiSurface, MarkdownContext, type ReactCatalogComponent} from '@a2ui/react';
import {MessageProcessor} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {renderMarkdown} from '@a2ui/markdown-it';

import {decisionCatalog} from './DecisionCard';
import {DraftBuilder} from './draft';

type Format = 'json' | 'express';
type Source = 'live' | 'replay';
type CatalogMode = 'basic' | 'custom';
type Status = 'idle' | 'running' | 'done' | 'failed';

interface Meta {
  status: Status;
  source?: Source;
  ms?: number;
  startedAt?: number;
  outputTokens?: number;
  inputTokens?: number;
  chars?: number;
  attempts?: number;
}

interface WireEntry {
  id: number;
  direction: 'agent' | 'renderer' | 'note';
  label: string;
  text: string;
}

interface Info {
  model: string;
  effort: string;
  catalogId: string;
  snippetChars: Record<Format, number>;
  recordings: number;
}

const PRESETS = [
  '이번 주말 제주도 1박 2일 일정을 짜 줘. 숙소 후보 3곳도 골라 줘.',
  '금요일 팀 회식 장소를 예약하려고 해. 필요한 정보를 물어봐 줘.',
  '노트북 3종(맥북 에어, 맥북 프로 14, 그램 16)을 개발자 기준으로 비교해 줘.',
  // 작업하던 에이전트가 사람에게 결정을 묻는 상황.
  '너는 영상 편집을 맡은 작업 에이전트야. 자막이 음성보다 0.12초 늦는 걸 발견했어. 내 결정이 필요하니 나한테 물어봐 줘. 선택지는 전체 0.10초 당기기, 전체 0.15초 당기기, 구간별 수동 보정이고 네 추천은 0.10초야. 선택지마다 장단점과, 내가 고르면 네가 할 일을 알려 줘.',
];

let wireId = 0;

/** POST로 보낸 요청의 SSE 응답을 한 사건씩 읽는다. */
async function postEvents(
  body: unknown,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/turn', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`서버 응답 ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

function useElapsed(meta: Meta): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (meta.status !== 'running') return;
    const timer = setInterval(() => tick(n => n + 1), 100);
    return () => clearInterval(timer);
  }, [meta.status]);
  if (meta.status === 'running' && meta.startedAt) {
    return ((Date.now() - meta.startedAt) / 1000).toFixed(1) + '초';
  }
  return meta.ms !== undefined ? (meta.ms / 1000).toFixed(1) + '초' : '';
}

function MetaLine({meta}: {meta: Meta}) {
  const elapsed = useElapsed(meta);
  if (meta.status === 'idle') return <span className="meta">대기</span>;
  return (
    <span className="meta">
      {meta.status === 'running' && <span className="dot" />}
      {meta.source === 'replay' && <span className="badge replay">녹화 재생</span>}
      {meta.source === 'live' && <span className="badge live">실시간</span>}
      {elapsed}
      {meta.outputTokens ? ` · 출력 ${meta.outputTokens.toLocaleString()}토큰` : ''}
      {meta.attempts && meta.attempts > 1 ? ` · ${meta.attempts}번째에 통과` : ''}
      {meta.status === 'failed' ? ' · 실패' : ''}
    </span>
  );
}

function Markdown({text}: {text: string}) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.resolve(renderMarkdown(text)).then(result => {
      if (alive) setHtml(String(result));
    });
    return () => {
      alive = false;
    };
  }, [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{__html: html}} />;
}

export function App() {
  const [prompt, setPrompt] = useState(PRESETS[0]);
  const [format, setFormat] = useState<Format>('json');
  const [source, setSource] = useState<Source>('live');
  const [catalog, setCatalog] = useState<CatalogMode>('basic');
  const [info, setInfo] = useState<Info>();

  const [chatText, setChatText] = useState('');
  const [chatMeta, setChatMeta] = useState<Meta>({status: 'idle'});
  const [uiMeta, setUiMeta] = useState<Meta>({status: 'idle'});
  const [wire, setWire] = useState<WireEntry[]>([]);
  const [wireTab, setWireTab] = useState<'raw' | 'json'>('raw');
  const [draft, setDraft] = useState('');
  const [draftNote, setDraftNote] = useState<{ok: boolean; text: string}>();
  const [surfaceIds, setSurfaceIds] = useState<string[]>([]);

  const state = useRef({
    prompt: '',
    format: 'json' as Format,
    source: 'live' as Source,
    catalog: 'basic' as CatalogMode,
    raw: '',
  });
  const draftBuilder = useRef(new DraftBuilder());
  const actionRef = useRef<(action: any) => void>(() => {});
  const wireEnd = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController>(undefined);

  const processor = useMemo(
    () =>
      // 렌더러는 두 부품 목록을 모두 안다. 에이전트에게 어느 것을 알려 줄지는 위쪽 스위치가 정한다.
      new MessageProcessor<ReactCatalogComponent>([basicCatalog, decisionCatalog], action =>
        actionRef.current(action),
      ),
    [],
  );

  useEffect(() => {
    fetch('/api/info')
      .then(response => response.json())
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const sync = () => setSurfaceIds(Array.from(processor.model.surfacesMap.keys()));
    const created = processor.onSurfaceCreated(sync);
    const deleted = processor.onSurfaceDeleted(sync);
    return () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
  }, [processor]);

  useEffect(() => {
    wireEnd.current?.scrollIntoView({block: 'end'});
  }, [wire]);

  const clearSurfaces = useCallback(() => {
    for (const id of Array.from(processor.model.surfacesMap.keys())) processor.model.deleteSurface(id);
    draftBuilder.current.reset();
  }, [processor]);

  const appendWire = useCallback((direction: WireEntry['direction'], label: string, text: string) => {
    const id = ++wireId;
    setWire(entries => [...entries, {id, direction, label, text}]);
    return id;
  }, []);

  const applyMessages = useCallback(
    (incoming: unknown[]) => {
      // 스트림 조각을 화면별 한 벌로 모아 편집 칸에 보여 준다(부품은 id별로 합친다).
      draftBuilder.current.add(incoming);
      setDraft(JSON.stringify(draftBuilder.current.toMessages(), null, 2));
      const errors = processor.processMessagesWithErrors(incoming);
      for (const error of errors) {
        appendWire('renderer', '렌더러 → 에이전트 · error', JSON.stringify(error, null, 2));
      }
    },
    [appendWire, processor],
  );

  /** A2UI 쪽 한 차례(첫 질문 또는 버튼·폼 action)를 돌린다. */
  const runUiTurn = useCallback(
    async (body: Record<string, unknown>, label: string, signal: AbortSignal) => {
      setUiMeta({status: 'running', startedAt: Date.now()});
      setDraftNote(undefined);
      let entryId = appendWire('agent', label, '');
      let raw = '';
      let cleared = false;
      await postEvents(
        body,
        (event, data) => {
          if (event === 'start') setUiMeta(meta => ({...meta, source: data.source}));
          else if (event === 'delta') {
            raw += data.text;
            const id = entryId;
            setWire(entries =>
              entries.map(entry => (entry.id === id ? {...entry, text: entry.text + data.text} : entry)),
            );
          } else if (event === 'a2ui') {
            if (!cleared) {
              clearSurfaces();
              cleared = true;
            }
            applyMessages(data.messages);
          } else if (event === 'rejected') {
            appendWire('note', '검증기가 거부', data.message);
          } else if (event === 'retry') {
            raw = '';
            cleared = false;
            clearSurfaces();
            entryId = appendWire('agent', `${label} · 다시 쓰기 ${data.attempt}번째`, '');
          } else if (event === 'done') {
            state.current.raw = raw;
            setUiMeta(meta => ({
              ...meta,
              status: data.failed ? 'failed' : 'done',
              source: data.source,
              ms: data.ms,
              outputTokens: data.usage.outputTokens,
              inputTokens: data.usage.inputTokens,
              chars: data.chars,
              attempts: data.attempts,
            }));
          } else if (event === 'failure') {
            appendWire('note', '오류', data.message);
            setUiMeta(meta => ({...meta, status: 'failed'}));
          }
        },
        signal,
      );
    },
    [appendWire, applyMessages, clearSurfaces],
  );

  const runChatTurn = useCallback(async (body: Record<string, unknown>, signal: AbortSignal) => {
    setChatText('');
    setChatMeta({status: 'running', startedAt: Date.now()});
    await postEvents(
      body,
      (event, data) => {
        if (event === 'start') setChatMeta(meta => ({...meta, source: data.source}));
        else if (event === 'delta') setChatText(text => text + data.text);
        else if (event === 'done') {
          setChatMeta(meta => ({
            ...meta,
            status: 'done',
            source: data.source,
            ms: data.ms,
            outputTokens: data.usage.outputTokens,
            chars: data.chars,
          }));
        } else if (event === 'failure') {
          setChatText(text => text + `\n\n오류: ${data.message}`);
          setChatMeta(meta => ({...meta, status: 'failed'}));
        }
      },
      signal,
    );
  }, []);

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      if (!prompt.trim()) return;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      state.current = {prompt, format, source, catalog, raw: ''};
      setWire([]);
      setWireTab('raw');
      setDraft('');
      clearSurfaces();
      const common = {prompt, format, source, catalog};
      const fail = (set: typeof setChatMeta) => (error: unknown) => {
        if (abort.signal.aborted) return;
        set(meta => ({...meta, status: 'failed'}));
        console.error(error);
      };
      runChatTurn({...common, kind: 'text'}, abort.signal).catch(fail(setChatMeta));
      runUiTurn({...common, kind: 'a2ui'}, '에이전트 → 렌더러', abort.signal).catch(fail(setUiMeta));
    },
    [catalog, clearSurfaces, format, prompt, runChatTurn, runUiTurn, source],
  );

  // 화면의 버튼·폼이 만든 action을 에이전트로 돌려보낸다.
  actionRef.current = action => {
    const message = {version: '1.0', action};
    appendWire('renderer', '렌더러 → 에이전트 · action', JSON.stringify(message, null, 2));
    const surface = processor.model.surfacesMap.get(action.surfaceId);
    const dataModel = surface?.dataModel?.get?.('/') ?? undefined;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const current = state.current;
    runUiTurn(
      {
        kind: 'action',
        prompt: current.prompt,
        format: current.format,
        source: current.source,
        catalog: current.catalog,
        action,
        dataModel,
        previous: current.raw,
      },
      '에이전트 → 렌더러',
      abort.signal,
    ).catch(error => {
      if (!abort.signal.aborted) console.error(error);
    });
  };

  const redraw = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (error) {
      setDraftNote({ok: false, text: `JSON 문법 오류: ${(error as Error).message}`});
      return;
    }
    const response = await fetch('/api/validate', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({messages: parsed}),
    });
    const result = await response.json();
    if (!result.ok) {
      setDraftNote({ok: false, text: `검증기가 거부: ${result.error}`});
      return;
    }
    clearSurfaces();
    const list = Array.isArray(parsed) ? parsed : [parsed];
    draftBuilder.current.add(list);
    const errors = processor.processMessagesWithErrors(list);
    setDraftNote(
      errors.length
        ? {ok: false, text: `렌더러 오류: ${JSON.stringify(errors[0])}`}
        : {ok: true, text: '검증 통과. 고친 JSON으로 다시 그렸습니다.'},
    );
  }, [clearSurfaces, draft, processor]);

  const surfaces = surfaceIds
    .map(id => processor.model.surfacesMap.get(id))
    .filter((surface): surface is NonNullable<typeof surface> => Boolean(surface));
  const busy = chatMeta.status === 'running' || uiMeta.status === 'running';

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      <div className="app">
        <header>
          <div className="title">
            <strong>A2UI 나란히 보기</strong>
            <span>같은 질문, 같은 모델. 왼쪽은 글로 답하고 오른쪽은 화면으로 답합니다.</span>
          </div>
          <div className="controls">
            <span className="chip">모델 {info ? `Claude ${info.model}` : '...'}</span>
            <span className="chip">A2UI v1.0</span>
            <div className="segmented" title="에이전트에게 알려 줄 부품 목록(카탈로그)">
              <button className={catalog === 'basic' ? 'on' : ''} onClick={() => setCatalog('basic')}>
                기본 부품
              </button>
              <button className={catalog === 'custom' ? 'on' : ''} onClick={() => setCatalog('custom')}>
                + 내 부품
              </button>
            </div>
            <div className="segmented" title="모델이 A2UI를 쓰는 표기법">
              <button className={format === 'json' ? 'on' : ''} onClick={() => setFormat('json')}>
                JSON
              </button>
              <button className={format === 'express' ? 'on' : ''} onClick={() => setFormat('express')}>
                Express
              </button>
            </div>
            <div className="segmented" title="녹화 재생은 전에 받은 응답을 같은 속도로 다시 흘려보냅니다">
              <button className={source === 'live' ? 'on' : ''} onClick={() => setSource('live')}>
                실시간
              </button>
              <button className={source === 'replay' ? 'on' : ''} onClick={() => setSource('replay')}>
                녹화 재생
              </button>
            </div>
          </div>
        </header>

        <form className="ask" onSubmit={submit}>
          <input
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder="에이전트에게 물어볼 말"
            spellCheck={false}
          />
          <button type="submit" className="primary">
            {busy ? '다시 보내기' : '보내기'}
          </button>
        </form>
        <div className="presets">
          {PRESETS.map((preset, index) => (
            <button key={preset} onClick={() => setPrompt(preset)}>
              예시 {index + 1}
            </button>
          ))}
        </div>

        <main>
          <section className="pane">
            <h2>
              <span>① 일반 챗봇 · 텍스트 응답</span>
              <MetaLine meta={chatMeta} />
            </h2>
            <div className="body chat">
              {chatText ? <Markdown text={chatText} /> : <p className="empty">글로 된 답이 여기에 옵니다.</p>}
            </div>
          </section>

          <section className="pane wire">
            <h2>
              <span>② 오간 메시지</span>
              <span className="tabs">
                <button className={wireTab === 'raw' ? 'on' : ''} onClick={() => setWireTab('raw')}>
                  모델이 쓴 원문
                </button>
                <button className={wireTab === 'json' ? 'on' : ''} onClick={() => setWireTab('json')}>
                  렌더러가 받은 JSON
                </button>
              </span>
            </h2>
            {wireTab === 'raw' ? (
              <div className="body code">
                {wire.length === 0 && <p className="empty">에이전트가 보낸 A2UI와, 화면이 돌려보낸 action이 여기에 찍힙니다.</p>}
                {wire.map(entry => (
                  <div key={entry.id} className={`entry ${entry.direction}`}>
                    <div className="entry-label">{entry.label}</div>
                    <pre>{entry.text}</pre>
                  </div>
                ))}
                <div ref={wireEnd} />
              </div>
            ) : (
              <div className="body editor">
                <textarea value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} />
                <div className="editor-bar">
                  <button className="primary" onClick={redraw} disabled={!draft}>
                    검증하고 다시 그리기
                  </button>
                  {draftNote && <span className={draftNote.ok ? 'ok' : 'bad'}>{draftNote.text}</span>}
                </div>
              </div>
            )}
          </section>

          <section className="pane">
            <h2>
              <span>③ A2UI · 앱이 자기 컴포넌트로 그린 화면</span>
              <MetaLine meta={uiMeta} />
            </h2>
            <div className="body surface">
              {surfaces.length === 0 && <p className="empty">에이전트가 설명한 화면이 여기에 그려집니다.</p>}
              {surfaces.map(surface => (
                <A2uiSurface key={surface.id} surface={surface} />
              ))}
            </div>
          </section>
        </main>
      </div>
    </MarkdownContext.Provider>
  );
}
