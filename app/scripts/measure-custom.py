#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""결정 요청(예시 4)을 기본 부품과 내 부품(DecisionCard)으로 각각 실시간 호출해 시간과 토큰을 잰다.

사용: python3 scripts/measure-custom.py http://<주소>:5273 <회차 수> <결과 파일>
"""
import json
import sys
import urllib.request

PROMPT = "너는 영상 편집을 맡은 작업 에이전트야. 자막이 음성보다 0.12초 늦는 걸 발견했어. 내 결정이 필요하니 나한테 물어봐 줘. 선택지는 전체 0.10초 당기기, 전체 0.15초 당기기, 구간별 수동 보정이고 네 추천은 0.10초야. 선택지마다 장단점과, 내가 고르면 네가 할 일을 알려 줘."
MODES = [("json", "basic"), ("json", "custom"), ("express", "basic"), ("express", "custom")]
if len(sys.argv) > 4 and sys.argv[4] == "custom-only":
    MODES = [("json", "custom"), ("express", "custom")]


def run(base, fmt, catalog):
    body = json.dumps({"kind": "a2ui", "format": fmt, "catalog": catalog, "prompt": PROMPT, "source": "live", "noRecord": True}).encode()
    req = urllib.request.Request(base + "/api/turn", data=body, headers={"content-type": "application/json"})
    event = None
    done = None
    rejected = []
    uses_card = False
    components = 0
    with urllib.request.urlopen(req, timeout=300) as res:
        for raw in res:
            line = raw.decode("utf-8").rstrip("\n")
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if event == "done":
                    done = data
                elif event == "rejected":
                    rejected.append(data["message"][:160])
                elif event == "a2ui":
                    text = json.dumps(data, ensure_ascii=False)
                    uses_card = uses_card or '"DecisionCard"' in text
    return {"done": done, "rejected": rejected, "usesDecisionCard": uses_card}


def main():
    base, rounds, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rows = []
    for r in range(rounds):
        for fmt, catalog in MODES:
            result = run(base, fmt, catalog)
            rows.append({"round": r + 1, "format": fmt, "catalog": catalog, **result})
            d = result["done"] or {}
            print(r + 1, fmt, catalog, d.get("ms"), d.get("usage"), "attempts", d.get("attempts"), "card", result["usesDecisionCard"], result["rejected"][:1], flush=True)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
