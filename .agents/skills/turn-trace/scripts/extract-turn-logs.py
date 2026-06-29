#!/usr/bin/env python3
"""Extract turn-scoped events from mixed stdout (JSON lines + noise).

Usage:
  python3 extract-turn-logs.py --turn-id 2071513753509167104 < logs.txt
  python3 extract-turn-logs.py --turn-id 2071513753509167104 --prompts logs.txt

Stdout: JSON summary for agent consumption (not for end users).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def parse_line(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line or not line.startswith("{"):
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def turn_match(obj: dict[str, Any], turn_id: str) -> bool:
    if obj.get("turnId") == turn_id or obj.get("traceId") == turn_id:
        return True
    return turn_id in json.dumps(obj, ensure_ascii=False)


def extract_system_prompts(request_body: str | dict[str, Any]) -> list[str]:
    if isinstance(request_body, str):
        rb = json.loads(request_body)
    else:
        rb = request_body
    systems: list[str] = []
    for msg in rb.get("messages", []):
        if msg.get("role") == "system":
            content = msg.get("content", "")
            systems.append(content if isinstance(content, str) else json.dumps(content))
    return systems


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract turn trace from logs")
    parser.add_argument("--turn-id", required=True, help="turnId or traceId")
    parser.add_argument(
        "--prompts",
        action="store_true",
        help="Include deduped system prompts from llm.bridge *.start",
    )
    parser.add_argument("file", nargs="?", help="Log file (default stdin)")
    args = parser.parse_args()

    src = open(args.file, encoding="utf-8") if args.file else sys.stdin
    events: list[dict[str, Any]] = []
    prompts_seen: set[tuple[str, int, str]] = set()
    prompts: list[dict[str, Any]] = []

    with src:
        for raw in src:
            obj = parse_line(raw)
            if not obj or not turn_match(obj, args.turn_id):
                continue
            events.append(
                {
                    "time": obj.get("time"),
                    "msg": obj.get("msg"),
                    "phase": obj.get("phase"),
                    "eventType": obj.get("eventType"),
                    "level": obj.get("level"),
                }
            )
            if args.prompts and obj.get("msg") in (
                "llm.bridge.chat.start",
                "llm.bridge.chatStream.start",
            ):
                rb = obj.get("requestBody")
                if not rb:
                    continue
                systems = extract_system_prompts(rb)
                key = (obj["msg"], len(systems), systems[0][:200] if systems else "")
                if key in prompts_seen:
                    continue
                prompts_seen.add(key)
                prompts.append(
                    {
                        "msg": obj["msg"],
                        "mode": obj.get("mode"),
                        "systems": [{"len": len(s), "preview": s[:120]} for s in systems],
                        "full": systems,
                    }
                )

    out: dict[str, Any] = {
        "turnId": args.turn_id,
        "eventCount": len(events),
        "events": events,
    }
    if args.prompts:
        out["systemPrompts"] = prompts

    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
