#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""예시 질문 3개를 텍스트·JSON·Express로 차례대로 실시간 호출해 시간과 토큰을 잰다.

사용: python3 scripts/measure.py http://<주소>:5273 <회차 수> <결과 파일>
서버가 떠 있어야 한다. 호출은 겹치지 않게 하나씩 보낸다.
"""
import json
import sys
import urllib.request

PROMPTS = [
    "이번 주말 제주도 1박 2일 일정을 짜 줘. 숙소 후보 3곳도 골라 줘.",
    "금요일 팀 회식 장소를 예약하려고 해. 필요한 정보를 물어봐 줘.",
    "노트북 3종(맥북 에어, 맥북 프로 14, 그램 16)을 개발자 기준으로 비교해 줘.",
]
MODES = [("text", "json"), ("a2ui", "json"), ("a2ui", "express")]


def run(base, kind, fmt, prompt):
    body = json.dumps({"kind": kind, "format": fmt, "prompt": prompt, "source": "live", "noRecord": True}).encode()
    req = urllib.request.Request(
        base + "/api/turn", data=body, headers={"content-type": "application/json"}
    )
    event = None
    done = None
    rejected = 0
    with urllib.request.urlopen(req, timeout=300) as res:
        for raw in res:
            line = raw.decode("utf-8").rstrip("\n")
            if line.startswith("event: "):
                event = line[7:]
            elif line.startswith("data: "):
                if event == "done":
                    done = json.loads(line[6:])
                elif event == "rejected":
                    rejected += 1
                elif event == "failure":
                    done = {"failure": json.loads(line[6:])}
    return {"done": done, "rejected": rejected}


def main():
    base, rounds, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    rows = []
    for r in range(rounds):
        for pi, prompt in enumerate(PROMPTS):
            for kind, fmt in MODES:
                label = "text" if kind == "text" else fmt
                result = run(base, kind, fmt, prompt)
                rows.append({"round": r + 1, "prompt": pi + 1, "mode": label, **result})
                print(r + 1, pi + 1, label, json.dumps(result, ensure_ascii=False), flush=True)
                with open(out, "w", encoding="utf-8") as f:
                    json.dump(rows, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
