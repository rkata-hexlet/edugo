#!/usr/bin/env python3
"""PreToolUse: запреты проекта из .claude/guard.txt — рабочей копии и ветки master.
Правила правятся в master, а ветка эпизода может отставать: без master-копии запрет 29.10 не дошёл
до episode/12 и машина зависла снова (31.10). Строки: `bash: <regex>  # причина` или `path: <regex>  # причина`. Код 2 — отказ, причина уходит Claude."""
import json, os, re, subprocess, sys

ev = json.load(sys.stdin)
inp = ev.get("tool_input") or {}
root = os.environ.get("CLAUDE_PROJECT_DIR", ".")
lines = []
local = os.path.join(root, ".claude", "guard.txt")
if os.path.exists(local):
    lines += open(local, encoding="utf-8").read().splitlines()
try:
    lines += subprocess.run(["git", "-C", root, "show", "master:.claude/guard.txt"],
                            capture_output=True, text=True, timeout=5).stdout.splitlines()
except Exception:
    pass
target = {"bash": inp.get("command", ""), "path": inp.get("file_path", "")}
for line in lines:
    line = line.strip()
    if not line or line.startswith("#") or ":" not in line:
        continue
    kind, rest = line.split(":", 1)
    pattern, _, why = rest.partition("  #")
    kind, pattern = kind.strip(), pattern.strip()
    if kind in target and target[kind] and re.search(pattern, target[kind]):
        print(f"Запрещено правилом проекта ({kind}: {pattern}): {why.strip() or 'см. .claude/guard.txt'}. "
              "Нужно всё-таки сделать — спроси пользователя.", file=sys.stderr)
        sys.exit(2)
