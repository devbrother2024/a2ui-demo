# A2UI 나란히 보기 데모

같은 질문을 같은 모델(Claude)에 두 번 보냅니다. 한 번은 평범한 글로, 한 번은 A2UI v1.0 화면으로 답하게 하고 세 칸에 나란히 보여 줍니다.

유튜브 "개발동생" 채널의 A2UI 영상에서 시연한 데모입니다.

| 칸 | 내용 |
|---|---|
| ① 일반 챗봇 | 모델이 쓴 Markdown 글 |
| ② 오간 메시지 | 에이전트가 보낸 A2UI 원문(JSON 또는 Express)과, 화면의 버튼·폼이 에이전트로 돌려보낸 action |
| ③ A2UI | 공식 React 렌더러(`@a2ui/react`)가 기본 카탈로그 부품으로 그린 화면 |

## 필요한 것

- Node.js 20.19 이상 또는 22.12 이상(Vite 8 기준), npm
- 실시간으로 모델을 부르려면 [Claude Code](https://claude.com/claude-code) 설치와 로그인
  - 서버가 `claude -p`를 불러 답을 받습니다. 별도 API 키는 쓰지 않습니다.
  - 호출은 로그인한 계정의 Claude 사용량에서 차감됩니다.
  - 최신 버전으로 올려 두세요(`claude update`). 오래된 버전에는 서버가 쓰는 옵션이 없을 수 있습니다.
- 녹화 재생만 볼 때는 Claude Code가 없어도 됩니다(아래 "녹화 재생" 참고).
- Python 3은 실측 스크립트(`app/scripts/measure*.py`)를 돌릴 때만 필요합니다. 표준 라이브러리만 씁니다.

## 설치

```bash
git clone https://github.com/devbrother2024/a2ui-demo.git
cd a2ui-demo/app
npm install
```

## 실행

```bash
npm run dev
```

브라우저에서 http://localhost:5273 을 엽니다.

- 모델 바꾸기: `DEMO_MODEL=haiku npm run dev` (기본 `sonnet`)
- 생각 강도: `DEMO_EFFORT=medium npm run dev` (기본 `low`)
- 포트: `PORT=5300 npm run dev` (기본 5273)
- 서버는 기본으로 모든 네트워크 주소(`0.0.0.0`)에서 받습니다. 내 컴퓨터에서만 열려면 `HOST=127.0.0.1 npm run dev`
- 끄기: 서버를 띄운 터미널에서 Ctrl+C

## 녹화 재생

- 위쪽 **실시간 / 녹화 재생** 스위치로 고릅니다. 처음 열면 실시간입니다.
- 녹화 재생은 `app/recordings/`에 저장된 응답을 녹화 때와 같은 속도로 다시 흘려보냅니다. 칸 제목에 "녹화 재생" 표시가 뜹니다.
- 저장소에는 예시 1~4의 응답이 들어 있습니다. 그래서 Claude Code 없이도 예시를 볼 수 있습니다.
- 녹화본이 없는 질문이나 버튼은 실시간으로 부릅니다. 이때는 Claude Code가 필요합니다.
- 실시간으로 보내면 응답을 `app/recordings/`에 새로 저장합니다. 같은 질문의 녹화본은 새 응답으로 바뀝니다.
- 받은 녹화본으로 되돌리기: `git checkout -- app/recordings`

## 화면 조작

- **예시 1~4**: 입력 칸에 질문을 채웁니다. 1 여행 일정, 2 회식 예약(폼), 3 노트북 비교, 4 작업 에이전트의 결정 요청. **보내기**를 누르면 ①과 ③이 동시에 시작합니다.
- **JSON / Express**: 모델이 A2UI를 쓰는 표기법입니다. JSON은 렌더러가 받는 형식 그대로입니다. Express는 공식 SDK가 JSON으로 바꿔 주는 짧은 표기법입니다.
- **기본 부품 / + 내 부품**: 에이전트에게 알려 줄 부품 목록(카탈로그)입니다. 기본 부품은 A2UI 기본 카탈로그만 씁니다. `+ 내 부품`은 직접 만든 `DecisionCard`(결정 카드)를 더합니다. `+ 내 부품`에서 예시 4를 보내면 카드와 버튼을 조립하는 대신 결정 카드 한 장이 옵니다.
- **렌더러가 받은 JSON** 탭: 화면을 만든 메시지를 직접 고치고 **검증하고 다시 그리기**를 누릅니다. 카탈로그에 없는 부품을 쓰면 공식 검증기가 거부합니다.
- ③의 버튼을 누르거나 폼을 제출하면 ②에 `렌더러 → 에이전트 · action`이 찍히고, 에이전트가 새 화면으로 답합니다.

## 구조

- `app/server/llm.ts`: `claude -p`를 도구·MCP 없이 빈 임시 폴더에서 불러 글자를 흘려받습니다.
- `app/server/a2ui.ts`: 공식 에이전트 SDK(`@a2ui/agent`)로 시스템 프롬프트 조각을 만들고 모델 출력을 검증합니다.
- `app/server/index.ts`: 한 차례를 SSE로 흘려보내고 녹화·재생합니다. 검증에 걸리면 오류를 붙여 한 번 다시 쓰게 합니다.
- `app/src/App.tsx`: 공식 렌더러(`MessageProcessor`, `A2uiSurface`)에 메시지를 넣어 그립니다.
- `app/shared/decision-card.ts`: 내 부품 `DecisionCard`의 약속(이름, 받는 속성). 에이전트 쪽과 화면 쪽이 이 파일 하나를 같이 씁니다.
- `app/src/DecisionCard.tsx`: 그 부품을 그리는 코드. 모양은 에이전트가 아니라 이 파일이 정합니다.
- `app/src/draft.ts`: 스트림으로 받은 메시지를 편집 탭에 보여 줄 한 벌로 모읍니다.
- `app/scripts/check-draft.ts`: 녹화본 전부로 위 합치기를 검사합니다(`cd app && npx tsx scripts/check-draft.ts`).
- `app/scripts/measure.py`, `app/scripts/measure-custom.py`: 시간과 토큰 실측. 서버를 띄운 뒤 `python3 app/scripts/measure.py http://localhost:5273 3 result.json`. 실측 호출은 녹화본으로 저장하지 않습니다.
- `app/catalog/basic-v1.json`: A2UI v1.0 기본 카탈로그(공식 저장소에서 복사).

## 실측 결과

영상에서 보여 드린 숫자의 바탕입니다. 질문 3개를 방식마다 3번씩 보낸 중앙값입니다(Claude Sonnet, 생각 강도 low). 측정 스크립트는 `app/scripts/measure.py`입니다.

| 방식 | 입력 토큰 | 출력 토큰 | 응답 시간 | 결과 |
|---|---|---|---|---|
| 글 답 | 약 690 | 약 1,830 | 15.6초 | |
| A2UI JSON | 약 17,900 | 약 1,860 | 11.7초 | 9번 모두 한 번에 검증 통과 |
| A2UI Express | 약 8,940 | 약 1,200 | 12.2초 | 9번 모두 통과(2번은 다시 쓰기) |

- 입력 토큰이 큰 것은 매 요청에 카탈로그 설명서가 같이 가기 때문입니다.
- 내 부품 `DecisionCard`를 더하고 규칙을 보강한 뒤 8번 잰 결과: 입력 약 14,900, 출력 약 900, 6.8초, 다시 쓰기 0번.
- 컴퓨터, 모델 버전, 시간대에 따라 달라집니다.

## 쓰는 패키지

- `@a2ui/react` 0.15.0, `@a2ui/web_core` 0.15.0, `@a2ui/agent` 0.1.0
- A2UI 프로토콜 v1.0, 기본 카탈로그 `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`

## 공식 A2UI 자료

- 사이트와 스펙: https://a2ui.org/
- 저장소: https://github.com/a2ui-project/a2ui (예전 주소 github.com/google/A2UI 는 여기로 넘어옵니다)

## 라이선스

- `app/catalog/basic-v1.json`은 공식 A2UI 저장소의 기본 카탈로그이고 Apache-2.0입니다. 원문은 `app/catalog/LICENSE-a2ui`에 있습니다.
- 그 밖의 코드는 MIT 라이선스입니다(`LICENSE`).
