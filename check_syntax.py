"""Static sanity checks for the browser code (no Node.js needed).

  python check_syntax.py

1. brace/paren/bracket balance of every script, ignoring strings & comments
2. every renderer in widgets.js returns the { getResp, reveal, clear } shape
3. the public API (render / grade / summarize / util) is present
"""
import re, sys
FILES = ["app.js", "app2.js", "app3.js", "widgets.js"]
PAIR = {")": "(", "]": "[", "}": "{"}


def strip(src):
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            q, i = c, i + 1
            while i < n and src[i] != q:
                i += 2 if src[i] == "\\" else 1
            i += 1
            continue
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def balance(src, name):
    s, stack, bad = strip(src), [], None
    for k, ch in enumerate(s):
        line = s.count("\n", 0, k) + 1
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack or stack[-1][0] != PAIR[ch]:
                return "unmatched %r at line %d" % (ch, line)
            stack.pop()
    if stack:
        bad = "unclosed %r opened at line %d" % (stack[-1][0], stack[-1][1])
    return bad


def renderer_shapes(wjs):
    """each renderer body must return getResp + reveal + clear so the dispatcher works"""
    bad = []
    starts = [m.start() for m in re.finditer(r"^  function render\w+\(", wjs, re.M)]
    for i, at in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else wjs.rindex("})(typeof window")
        body = wjs[at:end]
        name = re.match(r"\s*function (\w+)", body[2:]).group(1)
        for key in ("getResp", "reveal", "clear"):
            if not re.search(r"\b%s\s*:" % key, body):
                bad.append("%s missing %s" % (name, key))
    return bad


fail = 0
for f in FILES:
    bad = balance(open(f, encoding="utf-8").read(), f)
    print("%-11s %s" % (f, "ok" if not bad else "FAIL - " + bad))
    fail += bool(bad)

wjs = open("widgets.js", encoding="utf-8").read()
bad = renderer_shapes(wjs)
print("%-11s %s" % ("renderers", "ok (all return getResp/reveal/clear)" if not bad else "FAIL - " + "; ".join(bad)))
fail += bool(bad)
api = [n for n in ("render", "grade", "summarize", "util") if re.search(r"Widgets\.%s\s*=" % n, wjs)]
print("%-11s %s" % ("api", "ok - " + ", ".join(api) if len(api) == 4 else "FAIL - only " + str(api)))
fail += len(api) != 4
print("\n%s" % ("ALL STRUCTURE CHECKS PASSED" if not fail else "%d FILE(S) HAVE PROBLEMS" % fail))
sys.exit(1 if fail else 0)
