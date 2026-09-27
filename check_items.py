"""Static integrity check of exam-data.json against the contract widgets.js expects.
Run:  python _check.py
"""
import json, re, collections

d = json.load(open("exam-data.json", encoding="utf-8"))
def n(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower().rstrip(":").strip()

problems = collections.defaultdict(list)
stats = collections.Counter()

def bad(ref, msg):
    problems[msg].append(ref)

for p in d["projects"]:
    for t in p["tasks"]:
        it = t["item"]
        ref, ty = t["ref"], it["type"]
        stats[ty] += 1
        if not (t["instruction"] or "").strip():
            bad(ref, "empty instruction")
        if not (t["correctAnswer"] or "").strip():
            bad(ref, "empty correctAnswer")
        if ty == "text":
            continue
        if not it.get("prompt"):
            bad(ref, "no prompt blocks")

        if ty in ("choice", "multi") or (ty == "hotarea" and (it.get("graphic") or not it.get("blanks"))):
            opts = it.get("options") or []
            ids = [o["id"] for o in opts]
            if len(opts) < 2:
                bad(ref, "choice: fewer than 2 options")
            if len(set(ids)) != len(ids):
                bad(ref, "choice: duplicate option ids")
            if not it.get("answer"):
                bad(ref, "choice: no answer")
            elif set(it["answer"]) - set(ids):
                bad(ref, "choice: answer id not in options")
            if any(not str(o["text"]).strip() for o in opts):
                bad(ref, "choice: blank option text")
            if all(n(o["text"]).startswith(o["id"] + ".") for o in opts):
                bad(ref, "choice: letter duplicated in text")

        elif ty == "yesno":
            if len(it.get("statements", [])) != len(it.get("answer", [])):
                bad(ref, "yesno: statements/answer length mismatch")
            if any(a not in ("Yes", "No") for a in it.get("answer", [])):
                bad(ref, "yesno: answer not Yes/No")
            if any("|" in s for s in it.get("statements", [])):
                bad(ref, "yesno: stray table pipe in statement")

        elif ty == "sequence":
            blocks, ans = it.get("blocks") or [], it.get("answer") or []
            if len(ans) < 2:
                bad(ref, "sequence: fewer than 2 steps")
            if len(blocks) < len(ans):
                bad(ref, "sequence: pool smaller than answer")
            nb = {n(b) for b in blocks}
            if any(n(a) not in nb for a in ans):
                bad(ref, "sequence: answer step missing from pool")

        elif ty == "match":
            zids = {z["id"] for z in it.get("zones", [])}
            toks = it.get("tokens", [])
            if len(it.get("zones", [])) < 2:
                bad(ref, "match: fewer than 2 zones")
            if any(t.get("zone") and t["zone"] not in zids for t in toks):
                bad(ref, "match: token points at unknown zone")
            if zids - {t.get("zone") for t in toks}:
                bad(ref, "match: zone without any token")
            if not any(t.get("zone") is None for t in toks):
                stats["match:no-distractor"] += 1

        elif ty in ("dropblank", "hotarea") and it.get("blanks"):
            bl = it["blanks"]
            tpl_ids = {s["blank"] for s in it.get("template", []) if "blank" in s}
            if {b["id"] for b in bl} != tpl_ids:
                bad(ref, "blanks: template/blank id mismatch")
            pool = {n(x) for x in (it.get("pool") or [])}
            for b in bl:
                allow = {n(x) for x in (b.get("options") or [])} | pool
                if n(b["answer"]) not in allow:
                    bad(ref, "blanks: answer not offered in pool/options (blank %s)" % b["id"])
            if not pool:
                bad(ref, "blanks: empty pool")
            if len(pool) < 2:
                bad(ref, "blanks: pool has no distractors")

        elif ty == "groupchoice":
            if len(it.get("groups", [])) != len(it.get("answer", [])):
                bad(ref, "groupchoice: groups/answer length mismatch")
            for g, a in zip(it["groups"], it["answer"]):
                if n(a) not in {n(o) for o in g["options"]}:
                    bad(ref, "groupchoice: answer not in group options")
                if len(g["options"]) < 2:
                    bad(ref, "groupchoice: group with <2 options")

        elif ty == "fillblank":
            tpl_ids = {s["blank"] for s in it.get("template", []) if "blank" in s}
            if {b["id"] for b in it["blanks"]} != tpl_ids:
                bad(ref, "fillblank: template/blank id mismatch")

        else:
            bad(ref, "unhandled widget type: %s" % ty)

print("tasks: %d   projects: %d" % (sum(stats[t] for t in stats if ":" not in t), len(d["projects"])))
for k, v in sorted(stats.items()):
    print("   %-22s %d" % (k, v))
print("\nproblems: %d kinds" % len(problems))
for msg, refs in sorted(problems.items()):
    print("   [%2d] %-58s %s" % (len(refs), msg, refs[:4]))
