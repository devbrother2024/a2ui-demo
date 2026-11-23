// 모델 호출: 이미 로그인된 Claude Code CLI(claude -p)를 하네스 없이 한 번 부른다.
// 새 API 키가 필요 없다. 도구·MCP·CLAUDE.md를 모두 끄고 시스템 프롬프트만 준다.
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface StreamResult {
  text: string;
  usage: TurnUsage;
}

export const MODEL = process.env.DEMO_MODEL ?? 'sonnet';
export const EFFORT = process.env.DEMO_EFFORT ?? 'low';

const emptyDir = mkdtempSync(path.join(tmpdir(), 'a2ui-demo-'));

/** Claude에게 한 번 묻고, 글자가 올 때마다 onDelta를 부른다. */
export function streamClaude(
  system: string,
  input: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
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
        MODEL,
        '--effort',
        EFFORT,
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
      ],
      {cwd: emptyDir, stdio: ['pipe', 'pipe', 'pipe']},
    );
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));

    let buffer = '';
    let text = '';
    let stderr = '';
    let usage: TurnUsage = {inputTokens: 0, outputTokens: 0, thinkingTokens: 0};
    let failed: string | undefined;

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'stream_event') {
        const delta = event.event?.delta;
        if (event.event?.type === 'content_block_delta' && delta?.type === 'text_delta') {
          text += delta.text;
          onDelta(delta.text);
        }
      } else if (event.type === 'result') {
        const u = event.usage ?? {};
        usage = {
          inputTokens:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
          thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
        };
        if (event.is_error) failed = String(event.result ?? 'model call failed');
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', code => {
      handleLine(buffer);
      if (failed) reject(new Error(failed));
      else if (code !== 0) reject(new Error(`claude exited with ${code}: ${stderr || text}`));
      else resolve({text, usage});
    });
    child.stdin.end(input);
  });
}
