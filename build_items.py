r"""
build_items.py - turn EXAM_A_B_F_Q1-Q56.pdf into typed, interactive exam items.

The reviewer PDF has one question per page and a very stable shape:

    <section title>
    QUESTION 12 - Hotspot
    1. QUESTION & STATEMENTS            <prompt text + code>
    2. OPTIONS / BLANK ANSWER AREA      <option list, token pool, answer area>
    3. CORRECT ANSWER - COMPLETE ...    <answer key, completed area, notes>

This script classifies every question into one of the engine item types
(choice / multi / yesno / hotarea / dropblank / sequence / match / fillblank /
text) and emits exam-items.json + exam-items.js for the browser front-end.

    python build_items.py [path\to\other.pdf]

Questions the source PDF cannot supply (multi-select, term matching, typed
fill-in-the-blank, graphic hot-spot) are added from AUTHORED below and are
flagged "authored": true so the UI can label them honestly.
"""
import json
import os
import re
import sys
from collections import Counter

SRC = r"c:\Users\Heinz\Downloads\HTML EXAM\EXAM_A_B_F_Q1-Q56.pdf"
BASE = os.path.dirname(os.path.abspath(__file__))

CURLY = {
    "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
    "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00a0": " ",
    "\uf0b7": "", "\u25aa": "", "\u25a0": "", "\u2713": "", "\u2714": "",
}
CONTROL_RE = re.compile(r"[\uf000-\uf0ff]|[\x00-\x08\x0b-\x1f\x7f\u25a1\u25cb\u2610\u2611]")

S1 = "1. QUESTION & STATEMENTS"
S2_RE = re.compile(r"^2\.\s+OPTIONS\s*/\s+(BLANK\s+)?ANSWER AREA$", re.I)
S3 = "3. CORRECT ANSWER"
Q_RE = re.compile(r"^QUESTION\s+(\d+)\s*(?:-\s*(.+?))?\s*$", re.I)
LETTER_RE = re.compile(r"^([A-H])[\.\)]\s+(.*)$")
ANS_LETTER_RE = re.compile(r"Correct Answer(?:\s*\(per source\))?\s*:\s*([A-H](?:\s*[,,]\s*[A-H])*)", re.I)
ANSWER_KEY_RE = re.compile(r"^\s*(\d+)\s*[\.::]\s*(.+)$")
BLANK_N_RE = re.compile(r"^Blank\s*(\d+)\s*:\s*(.+)$", re.I)
NUMBERS_RE = re.compile(r"blanks?\s+([\d\s,&and]+?)\s*:", re.I)


def clean(s):
    for k, v in CURLY.items():
        s = s.replace(k, v)
    return CONTROL_RE.sub("", s)


def squeeze(s):
    return re.sub(r"\s+", " ", s).strip()


def lines_of(text, keep_empty=False):
    out = [clean(l).rstrip() for l in text.replace("\r\n", "\n").split("\n")]
    return out if keep_empty else [l for l in out if l.strip() != ""]


def is_code_line(line):
    """Heuristic: does this line belong in a monospaced code block?"""
    t = line.strip()
    if not t:
        return False
    if re.match(r"^<[/!A-Za-z]", t) or t.startswith(">"):
        return True
    if re.match(r"^\d{2}\s+<", t):                       # "01 <!DOCTYPE html>"
        return True
    if re.match(r"^[\w.#@:\-\[\]*>+~]+\s*\{", t):        # css rule head
        return True
    if t in ("}", "{", "}", ") {", "})", "} else {", ")"):
        return True
    if re.match(r"^[{}()\[\]]+$", t):
        return True
    if re.search(r"[:=]\s*[^:]*;$", t) and not re.search(r"\b(is|of|the|and)\b", t.lower()):
        return True
    if re.match(r"^(url|@media|@import|background|color|font|display|margin|padding|border)[\w-]*\s*[:{(]", t):
        return True
    return False


def split_parts(lines):
    """Turn text lines into [{kind:'p'|'code', text}] blocks for rendering."""
    parts, buf, kind = [], [], None

    def flush():
        if buf:
            parts.append({"kind": kind, "text": "\n".join(buf).strip("\n")})
            buf.clear()

    for line in lines:
        k = "code" if is_code_line(line) else "p"
        if k != kind:
            flush()
            kind = k
        buf.append(line)
    flush()
    return [p for p in parts if p["text"].strip()]


def section_body(lines, start, stops):
    """Collect lines from start until one of `stops` matches."""
    body = []
    for line in lines[start:]:
        if any(stop(line) for stop in stops):
            break
        body.append(line)
    return body


# --- block grouping: turn a run of lines into HTML/code "segments" ------------
def group_blocks(lines):
    blocks, buf, depth = [], [], 0
    for line in lines:
        t = line.strip()
        if not t:
            continue
        opens = len(re.findall(r"<(?!/|!|\?)([A-Za-z][\w:-]*)[^>]*?>", t))
        closes = len(re.findall(r"</([A-Za-z][\w:-]*)>", t))
        selfcontained = bool(re.search(r"/>$", t)) or bool(re.match(r"^</", t) and depth == 0 and not buf)
        if not buf and depth == 0 and selfcontained and opens == closes:
            blocks.append(t)
            continue
        buf.append(t)
        depth += opens - closes
        if depth <= 0:
            depth = 0
            blocks.append("\n".join(buf))
            buf = []
    if buf:
        blocks.append("\n".join(buf))
    return blocks


# --- answer-area helpers ------------------------------------------------------
POOL_WORDS = r"(?:pool|segments|elements|choices|tokens|tags|values|attributes|properties|options)"
POOL_HEAD_RE = re.compile(
    r"(?i)^\s*[\w /()+.'-]{0,40}\b" + POOL_WORDS + r"\b\s*:?\s*$"
    r"|^\s*.{0,40}\((?:pool|drop-?downs?)\)\s*:?\s*$"
    r"|^\s*available\s+[\w /()-]{0,30}\s*[:]?\s*$")
AREA_HEAD_RE = re.compile(
    r"(?i)^\s*(answer\s+area|complete(?:\s+the\s+[\w /()-]{0,30})?|available\s+markup\s+segments.*"
    r"|answer\s+area\s*:?|answer\s*:?|the\s+markup.*:|.*\sshould\s+be:)\s*:?\s*$")
PLACEHOLDER_RE = re.compile(r"\[\s*(\d+)\s*\]|\[\s*(?:drop-?down|blank)\s*(\d+)\s*\]"
                            r"|_{2,}\(\s*(\d+)\s*\)_{2,}|_{3,}")
ARROW_RE = re.compile(r"^\s*(.+?)\s*(?:\u2192|->|=>)\s*(.+?)\s*$")
UNUSED_RE = re.compile(r"(?i)^unused\s+(?:option|distractor)s?\s*:?\s*(.+)$")
UNKNOWN_RE = re.compile(r"(?i)not\s+(?:confirmed|available|supplied|extracted)|unknown|unclear|\[source|\[the")




def find_index(lines, predicate, start=0):
    for i in range(start, len(lines)):
        if predicate(lines[i]):
            return i
    return -1


def pick_pool_tokens(lines):
    """A token pool is either a space/pipe separated word list or code blocks."""
    body = [l.strip() for l in lines if l.strip()]
    body = [l for l in body
            if not POOL_HEAD_RE.match(l) and not AREA_HEAD_RE.match(l) and not UNKNOWN_RE.search(l)]
    if not body:
        return []
    joined = " ".join(body)
    if "<" not in joined and "{" not in joined and "\u2192" not in joined:
        toks = [t for t in re.split(r"[\s|,]+", joined) if t and t not in ("|", ",")]
        if len(toks) >= 2:
            return toks
    return group_blocks(body)


def parse_template(text_lines):
    """Return (segments, ordered blank indexes) from answer-area lines."""
    src = "\n".join(text_lines)
    segs, blanks, auto, pos = [], [], 0, 0
    for m in PLACEHOLDER_RE.finditer(src):
        explicit = m.group(1) or m.group(2)
        idx = int(explicit) if explicit else 0
        if not idx:
            auto += 1
            idx = auto
            while idx in blanks:
                auto += 1
                idx = auto
        if m.start() > pos:
            segs.append({"text": src[pos:m.start()]})
        segs.append({"blank": idx})
        if idx not in blanks:
            blanks.append(idx)
        pos = m.end()
    if pos < len(src):
        segs.append({"text": src[pos:]})
    return segs, blanks


def parse_blank_options(lines):
    """'Options for blanks 1 & 2: span | table | h1' -> {1: [...], 2: [...]}"""
    per = {}
    for line in lines:
        m = NUMBERS_RE.search(line)
        if not m:
            continue
        nums = [int(n) for n in re.findall(r"\d+", m.group(1))]
        opts = [o.strip() for o in line.split(":", 1)[1].split("|") if o.strip()]
        for n in nums:
            if opts:
                per[n] = opts
    return per


def parse_answer_values(ans_lines):
    """{blankNumber: value} from 'Blank 1: x' lines, an Answer Key, or 'Answer: a, b'."""
    vals = {}
    for line in ans_lines:
        m = BLANK_N_RE.match(line.strip())
        if m:
            vals[int(m.group(1))] = m.group(2).strip()
    if vals:
        return vals
    key_at = find_index(ans_lines, lambda l: l.strip().lower().startswith("answer key"))
    if key_at >= 0:
        for line in ans_lines[key_at + 1:]:
            m = ANSWER_KEY_RE.match(line)
            if m:
                vals[int(m.group(1))] = m.group(2).strip()
        if vals:
            return vals
    for line in ans_lines:
        m = re.match(r"^Answer\s*:\s*(.+)$", line.strip(), re.I)
        if m:
            parts = [p.strip() for p in m.group(1).split(",") if p.strip()]
            return {i + 1: v for i, v in enumerate(parts)}
    return {}


def mode_for(declared, prompt_text):
    t = (declared or "") + " " + prompt_text
    if re.search(r"(?i)drag|move all|arrange them|in what order|in the correct order", t):
        return "drag"
    if re.search(r"(?i)select the appropriate|select each|drop-?down", t):
        return "hotspot"


# --- classifiers --------------------------------------------------------------
def try_yesno(raw):
    opt, ans = raw["opt"], raw["ans"]
    hdr = find_index(opt, lambda l: re.match(r"(?i)^\s*statement\b", l.strip()))
    if hdr < 0:
        return None
    statements = [squeeze(l) for l in opt[hdr + 1:]
                  if len(squeeze(l)) > 3 and squeeze(l).lower() not in ("yes", "no")
                  and not re.match(r"(?i)^yes\s*\|\s*no$", squeeze(l))]
    answers = {}
    key_at = find_index(ans, lambda l: l.strip().lower().startswith("answer key"))
    if key_at >= 0:
        for line in ans[key_at + 1:]:
            m = ANSWER_KEY_RE.match(line)
            if m and re.match(r"^(yes|no)\b", m.group(2), re.I):
                answers[int(m.group(1))] = m.group(2).strip().title()
    if not statements or len(answers) != len(statements):
        return None
    return {
        "type": "yesno",
        "statements": statements,
        "answer": [answers[i + 1] for i in range(len(statements))],
        "columns": ["Yes", "No"],
    }


def norm(s):
    return squeeze(s).lower().rstrip(":").strip()


def try_blank(raw):
    opt, ans = raw["opt"], raw["ans"]
    area_at = find_index(opt, lambda l: AREA_HEAD_RE.match(l.strip()))
    pool_at = find_index(opt, lambda l: POOL_HEAD_RE.match(l.strip()))
    area_lines = opt[area_at + 1:] if area_at >= 0 else opt
    if not any(PLACEHOLDER_RE.search(l) for l in area_lines):
        return None
    segs, blanks = parse_template(area_lines)
    if not blanks:
        return None
    per_opts = parse_blank_options(opt)
    pool_end = area_at if area_at >= 0 else len(opt)
    pool_start = pool_at + 1 if pool_at >= 0 else 0
    pool = pick_pool_tokens(opt[pool_start:pool_end]) if pool_start < pool_end else []
    values = parse_answer_values(ans)
    if not values:
        return None
    blank_objs, keep = [], []
    for b in blanks:
        val, opts = values.get(b), per_opts.get(b) or pool
        if not val or not opts or UNKNOWN_RE.search(val):
            continue                                   # unverifiable in source
        hit = next((o for o in opts if norm(o) == norm(val)), None)
        hit = hit or next((o for o in opts if norm(val) and norm(val) in norm(o)), None)
        if not hit:
            continue
        keep.append(b)
        blank_objs.append({"id": b, "options": opts, "answer": hit})
    if not blank_objs:
        return None
    segs = [{"text": " ______ "} if s.get("blank") not in keep else s for s in segs]
    pool = pool or sorted({o for blk in blank_objs for o in blk["options"]})
    drag = mode_for(raw["declared"], raw["prompt_text"]) == "drag"
    return {
        "type": "dropblank" if drag else "hotarea",
        "template": segs,
        "blanks": blank_objs,
        "pool": pool,
        "reusable": not bool(re.search(r"(?i)each (?:segment|token|term) may be used only once",
                                       raw["prompt_text"])),
        "partial": len(blank_objs) < len(blanks) or None,
    }


def try_match(raw):
    """Two-column matching tables keyed by 'term -> content' lines in the answer."""
    opt, ans = raw["opt"], raw["ans"]
    pairs = []
    for line in ans:
        m = ARROW_RE.match(line.strip())
        if not m:
            continue
        a, b = squeeze(m.group(1)), squeeze(m.group(2))
        if len(a) > 1 and len(b) > 1 and not UNKNOWN_RE.search(a + b):
            pairs.append((a, b))
    if len(pairs) < 2:
        return None
    head_at = find_index(opt, lambda l: POOL_HEAD_RE.match(l.strip()))
    pool = pick_pool_tokens(opt[head_at + 1:] if head_at >= 0 else opt)
    poolset = {norm(p) for p in pool}
    left = sum(1 for a, _ in pairs if norm(a) in poolset)
    right = sum(1 for _, b in pairs if norm(b) in poolset)
    flip = right > left
    zones, tokens = [], []
    for a, b in pairs:
        term, zone = (b, a) if flip else (a, b)
        zid = next((z["id"] for z in zones if norm(z["label"]) == norm(zone)), None)
        if not zid:
            zid = "z%d" % (len(zones) + 1)
            zones.append({"id": zid, "label": zone})
        tokens.append({"id": "t%d" % (len(tokens) + 1), "text": term, "zone": zid})
    for line in ans:
        m = UNUSED_RE.match(line.strip())
        if not m:
            continue
        for d in re.split(r"[,;]", m.group(1)):
            d = squeeze(d).rstrip(".")
            if d and norm(d) not in {norm(t["text"]) for t in tokens}:
                tokens.append({"id": "t%d" % (len(tokens) + 1), "text": d, "zone": None})
    if len(zones) < 2 or len(tokens) < 3:
        return None
    return {"type": "match", "zones": zones, "tokens": tokens}


GROUP_HEAD_RE = re.compile(
    r"(?i)^\s*(?:element|part|label|row|item)\s*([A-Za-z0-9]{1,3})\s*[-\u2013]\s*options?\s*[:]?\s*$"
    r"|^\s*options?\s+for\s+(.{2,60}?)\s*[:]?\s*$"
    r"|^\s*(.{8,90}?\s+should\s+be)\s*[:]?\s*$")


def try_grouped(raw):
    """Hot-area questions that list one option set per labelled part of an exhibit."""
    opt, ans = raw["opt"], raw["ans"]
    heads = [(i, GROUP_HEAD_RE.match(l.strip())) for i, l in enumerate(opt)]
    heads = [(i, m) for i, m in heads if m]
    if len(heads) < 2:
        return None
    groups = []
    for n, (i, m) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(opt)
        items = [squeeze(x) for x in opt[i + 1:end] if len(squeeze(x)) > 3]
        label = squeeze(next((g for g in m.groups() if g), "")) or squeeze(opt[i])
        if len(items) >= 2:
            groups.append({"label": label.rstrip(" :"), "options": items})
    if len(heads) - len(groups) > 0 or len(groups) < 2:
        return None
    ansvals = [l for l in ans
               if not re.match(r"(?i)^\s*(completed|source answer|note:|references|answer key|section:)", l)]
    picks, used = [], set()
    for grp in groups:
        got = None
        for line in ansvals:
            for o in grp["options"]:
                if norm(o) and norm(o) in norm(line) and o not in used:
                    got = o
                    break
            if got:
                break
        if not got:
            return None
        used.add(got)
        picks.append(got)
    return {
        "type": "groupchoice",
        "groups": groups,
        "answer": picks,
    }



def try_sequence(raw):
    ans = raw["ans"]
    at = find_index(ans, lambda l: l.strip().lower().startswith("correct order"))
    if at < 0:
        return None
    stop = re.compile(r"(?i)^(completed answer area|source answer|unused|answer key|section:|explanation|references|note:)").match
    items, cur = [], None
    for line in ans[at + 1:]:
        m = re.match(r"^(\d+)\s*[.:.]\s*(.*)$", line.strip())
        if m:
            if cur:
                items.append(cur)
            cur = {"label": m.group(2).strip(), "body": []}
        elif cur is not None and not stop(line.strip()):
            cur["body"].append(line.strip())
    if cur:
        items.append(cur)
    blocks = [("\n".join(it["body"]) or it["label"]) for it in items]
    blocks = [b for b in blocks if b.strip()]
    if len(blocks) < 2:
        return None
    opt = raw["opt"]
    head_at = find_index(opt, lambda l: POOL_HEAD_RE.match(l.strip()))
    pool = group_blocks([l for l in (opt[head_at + 1:] if head_at >= 0 else opt)
                         if not re.match(r"(?i)^answer\s+area", l)])
    seen = {squeeze(b) for b in pool}
    for b in blocks:
        if squeeze(b) not in seen:
            seen.add(squeeze(b))
            pool.append(b)
    if len(pool) < len(blocks):
        return None
    c_at = find_index(ans, lambda l: l.strip().lower().startswith("completed answer area"))
    preview = None
    if c_at >= 0:
        preview = "\n".join(section_body(ans, c_at + 1, [stop]))
    return {
        "type": "sequence",
        "blocks": pool,
        "answer": blocks,
        "preview": preview or "\n".join(blocks),
    }

    return "drag"




def try_choice(raw):
    opt, ans = raw["opt"], raw["ans"]
    opts, seen = [], set()
    for line in opt:
        m = LETTER_RE.match(line.strip())
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            opts.append({"id": m.group(1), "text": squeeze(m.group(2))})
    if len(opts) < 2:
        return None
    letters = []
    m = ANS_LETTER_RE.search("\n".join(ans))
    if m:
        letters = [x.strip().upper() for x in m.group(1).split(",") if x.strip()]
    else:
        for line in ans:
            for o in opts:
                if squeeze(line).lower().startswith(o["id"].lower() + "."):
                    letters.append(o["id"])
                    break
            if letters:
                break
    letters = [l for l in letters if l in seen]
    if not letters:
        return None
    multi = len(letters) > 1 or bool(re.search(
        r"(?i)select all that apply|which (two|three|four)|each correct answer|choose (two|three|four)",
        raw["prompt_text"]))
    return {"type": "multi" if multi else "choice", "options": opts, "answer": sorted(letters)}


def try_reconstruct(raw):
    """Image-only answer area, but the published solution is text: rebuild a reorder task."""
    if not UNKNOWN_RE.search(" ".join(raw["opt"])):
        return None
    ans = raw["ans"]
    at = find_index(ans, lambda l: l.strip().lower().startswith("completed answer area"))
    if at < 0:
        return None
    stop = re.compile(r"(?i)^(answer:|source answer|unused|note:|section:|explanation|references|"
                      r"source limitation|correct answer)").match
    blocks = group_blocks(section_body(ans, at + 1, [stop]))
    if len(blocks) < 2:
        blocks = [squeeze(l) for l in section_body(ans, at + 1, [stop]) if squeeze(l)]
    if len(blocks) < 2 or len(blocks) > 12:
        return None
    return {"type": "sequence", "blocks": blocks, "answer": blocks,
            "preview": "\n".join(blocks), "derived": True}


CLASSIFIERS = [try_yesno, try_match, try_sequence, try_blank, try_grouped, try_choice,
               try_reconstruct]


def solution_text(ans_lines):
    drop = re.compile(r"(?i)^(section:\s*\(none\)|correct answer\s*[:\(])").match
    body = [l for l in ans_lines if not drop(l.strip())]
    return squeeze("\n".join(body))[:1400]


def explanation_text(ans_lines):
    at = find_index(ans_lines, lambda l: l.strip().lower().startswith("explanation"))
    body = ans_lines[at + 1:] if at >= 0 else [
        l for l in ans_lines if re.match(r"(?i)^(references|note):", l.strip())]
    return squeeze("\n".join(body))[:900]


def parse_page(section, text):
    lines = lines_of(text)
    if not lines:
        return None
    q_at = find_index(lines, lambda l: Q_RE.match(l.strip()))
    if q_at < 0:
        return None
    qm = Q_RE.match(lines[q_at].strip())
    num, declared = int(qm.group(1)), (qm.group(2) or "").strip()
    s1 = find_index(lines, lambda l: l.strip().startswith(S1), q_at)
    s2 = find_index(lines, lambda l: S2_RE.match(l.strip()), q_at)
    s3 = find_index(lines, lambda l: l.strip().startswith(S3), q_at)
    if min(s1, s2, s3) < 0 or not (s1 < s2 < s3):
        return None
    raw = {
        "section": section,
        "num": num,
        "declared": declared,
        "prompt_lines": lines[s1 + 1:s2],
        "opt": lines[s2 + 1:s3],
        "ans": lines[s3 + 1:],
    }
    raw["prompt_text"] = squeeze(" ".join(raw["prompt_lines"]))
    item = {"number": num, "declaredType": declared, "prompt": split_parts(raw["prompt_lines"]),
            "stem": raw["prompt_text"], "solution": solution_text(raw["ans"]),
            "explanation": explanation_text(raw["ans"]), "page": None}
    for fn in CLASSIFIERS:
        try:
            got = fn(raw)
        except Exception as exc:                                  # noqa: BLE001
            got, item["parseError"] = None, repr(exc)
        if got:
            item.update(got)
            return item
    item["type"] = "text"
    if UNKNOWN_RE.search(" ".join(raw["opt"])):
        item["unavailable"] = True          # answer area is an image in the source PDF
    return item


# --- items the reviewer PDF cannot express ------------------------------------
# Flagged "authored": the UI labels them so the learner knows they are not from
# the source file. Content stays inside the MTA 98-383 domain.
AUTHORED = [
    {
        "type": "multi", "authored": True, "number": 101, "declaredType": "Multiple Select (authored)",
        "prompt": [{"kind": "p", "text": "Which of the following are valid ways to attach an external "
                                         "stylesheet to an HTML document? Select all that apply."}],
        "stem": "Which of the following are valid ways to attach an external stylesheet?",
        "options": [
            {"id": "A", "text": '<link rel="stylesheet" href="site.css">'},
            {"id": "B", "text": '<style src="site.css">'},
            {"id": "C", "text": "@import url('site.css'); inside a style element or stylesheet"},
            {"id": "D", "text": '<script href="site.css">'},
            {"id": "E", "text": "<a rel=\"stylesheet\" href=\"site.css\">"},
        ],
        "answer": ["A", "C"],
        "solution": "A and C. <link rel=\"stylesheet\"> is the standard hook; @import also loads a stylesheet from CSS.",
        "explanation": "References: https://www.w3schools.com/css/css_intro.asp",
    },
    {
        "type": "match", "authored": True, "number": 102, "declaredType": "Drag and Drop (authored)",
        "prompt": [{"kind": "p", "text": "Match each CSS declaration to the box-model layer it affects. "
                                         "Drag every term onto the correct layer."}],
        "stem": "Match each CSS declaration to the box-model layer it affects.",
        "zones": [{"id": "content", "label": "Content box"}, {"id": "padding", "label": "Padding"},
                  {"id": "border", "label": "Border"}, {"id": "margin", "label": "Margin"}],
        "tokens": [
            {"id": "t1", "text": "background-color", "zone": "content"},
            {"id": "t2", "text": "width / height", "zone": "content"},
            {"id": "t3", "text": "padding", "zone": "padding"},
            {"id": "t4", "text": "border", "zone": "border"},
            {"id": "t5", "text": "border-radius", "zone": "border"},
            {"id": "t6", "text": "margin", "zone": "margin"},
            {"id": "t7", "text": "outline", "zone": "margin"},
        ],
        "solution": "Content box: background-color, width/height. Padding: padding. "
                    "Border: border, border-radius. Margin: margin, outline.",
    },
    {
        "type": "fillblank", "authored": True, "number": 103, "declaredType": "Fill in the Blank (authored)",
        "prompt": [{"kind": "p", "text": "Complete the media query so it applies when the viewport is "
                                         "600 pixels wide or less. Type each missing value."}],
        "stem": "Complete the media query for viewports 600 pixels wide or less.",
        "template": [{"text": "@media screen and ( "}, {"blank": 1},
                     {"text": " : "}, {"blank": 2},
                     {"text": " ) {\n  body { font-size: 14px; }\n}"}],
        "blanks": [{"id": 1, "accept": ["max-width"], "answer": "max-width"},
                   {"id": 2, "accept": ["600px", "600 px", "600"], "answer": "600px"}],
        "solution": "max-width : 600px",
    },
    {
        "type": "hotarea", "authored": True, "number": 104, "declaredType": "Hot Area (authored)",
        "prompt": [{"kind": "p", "text": "A page uses a two-column CSS grid. Click the region of the mock "
                                         "browser window that the rule below paints."}],
        "stem": "Click the region painted by the CSS rule.",
        "code": "body { display: grid; grid-template-columns: 104px 1fr; }\n"
                ".sidebar { grid-column: 1; grid-row: 1 / span 2; }",
        "graphic": {
            "viewBox": "0 0 460 200",
            "note": "Mock browser window - click exactly one region.",
            "regions": [
                {"id": "r1", "x": 12, "y": 40, "w": 436, "h": 26, "label": "Toolbar"},
                {"id": "r2", "x": 12, "y": 78, "w": 104, "h": 104, "label": "Sidebar"},
                {"id": "r3", "x": 128, "y": 78, "w": 320, "h": 60, "label": "Main"},
                {"id": "r4", "x": 128, "y": 146, "w": 320, "h": 36, "label": "Footer"},
            ],
        },
        "options": [{"id": "r1", "text": "Toolbar"}, {"id": "r2", "text": "Sidebar"},
                    {"id": "r3", "text": "Main"}, {"id": "r4", "text": "Footer"}],
        "answer": ["r2"],
        "solution": "Sidebar. The grid declares a 104 px track then one flexible track, and the "
                    "sidebar is pinned to track 1 across both rows.",
    },
]




# --- assembly -----------------------------------------------------------------
SECTION_RE = re.compile(r"(?i)(reviewer|exam [a-z]\b)")


def project_name(head):
    name = re.sub(r"(?i)q(\d+)\s+to\s+q(\d+)", r"Q\1-Q\2", head)
    name = re.sub(r"(?i)^exam\s+([a-z])\b", lambda m: "Exam " + m.group(1).upper(), name)
    return squeeze(name).strip(" -") or head


def build(path):
    try:
        from pypdf import PdfReader
    except ImportError:                                          # pragma: no cover
        from PyPDF2 import PdfReader
    reader = PdfReader(path)
    projects, items, warnings = [], [], []
    section = None
    for pno, page in enumerate(reader.pages, 1):
        raw = page.extract_text() or ""
        lines = lines_of(raw)
        head = lines[0].strip() if lines else ""
        if head and SECTION_RE.search(head) and not Q_RE.match(head) and head != section:
            section = head
            projects.append({"id": "p%d" % (len(projects) + 1), "name": project_name(head)})
        item = parse_page(section, raw)
        if item is None:
            warnings.append("page %d: no parsable question" % pno)
            continue
        if not projects:
            projects.append({"id": "p1", "name": "Exam"})
        proj = projects[-1]
        item["page"] = pno
        item["project"] = proj["id"]
        item["task"] = sum(1 for i in items if i.get("project") == proj["id"]) + 1
        item["id"] = "%s-t%d" % (proj["id"], item["task"])
        item["points"] = 1
        item["ref"] = "%s - Q%d (page %d)" % (proj["name"], item["number"], pno)
        items.append(item)

    extra = {"id": "px", "name": "Extra Practice (authored)"}
    projects.append(extra)
    for n, item in enumerate(AUTHORED, 1):
        item["project"] = extra["id"]
        item["task"] = n
        item["id"] = "px-t%d" % n
        item["points"] = 1
        item["page"] = None
        item["ref"] = "Authored practice item %d" % n
        items.append(item)

    for proj in projects:
        mine = [i for i in items if i["project"] == proj["id"]]
        proj["itemCount"] = len(mine)
        proj["duration"] = max(10, int(round(len(mine) * 1.5))) * 60
    return {"source": os.path.basename(path), "generator": "build_items.py",
            "projects": projects, "items": items}, warnings


# --- map to the study-simulator schema (projects -> tasks) --------------------
# Keys that describe an interactive widget; everything else on an item is
# metadata that the UI reads from the task itself.
WIDGET_KEYS = {
    "choice": ("options", "answer"),
    "multi": ("options", "answer"),
    "yesno": ("statements", "answer"),
    "sequence": ("blocks", "answer", "preview", "derived"),
    "match": ("zones", "tokens"),
    "dropblank": ("template", "blanks", "pool", "reusable", "partial"),
    "hotarea": ("template", "blanks", "pool", "reusable", "partial",
                "graphic", "code", "options", "answer"),
    "groupchoice": ("groups", "answer"),
    "fillblank": ("template", "blanks"),
    "text": ("unavailable",),
}


def widget_payload(item):
    payload = {"type": item["type"], "declaredType": item.get("declaredType") or "",
               "prompt": item.get("prompt") or [], "source": ("authored" if item.get("authored")
                                                              else ("page %s" % item.get("page")))}
    for key in WIDGET_KEYS.get(item["type"], ()):
        if item.get(key) is not None:
            payload[key] = item[key]
    if item.get("blanks") and item.get("template"):          # keep blanks ordered by id
        payload["blanks"] = sorted(payload["blanks"], key=lambda b: b["id"])
    return payload


def app_schema(data):
    """Same shape the simulator validates, plus a per-task `item` widget payload."""
    projects = []
    for i, proj in enumerate(data["projects"], 1):
        mine = [it for it in data["items"] if it.get("project") == proj["id"]]
        projects.append({
            "projectId": i,
            "projectName": proj["name"],
            "durationMinutes": proj["duration"] // 60,
            "tasks": [{
                "taskId": it["task"],
                "instruction": it.get("stem") or "(no statement provided)",
                "correctAnswer": it.get("solution") or "(answer shown in study mode)",
                "explanation": it.get("explanation") or "",
                "ref": it.get("ref") or "",
                "item": widget_payload(it),
            } for it in mine],
        })
    minutes = max(10, sum(p["durationMinutes"] for p in projects))
    types = Counter(it["type"] for it in data["items"])
    return {
        "examTitle": "HTML & CSS Reviewer - CertiClone practice set",
        "timeLimitMinutes": minutes,
        "source": data["source"],
        "itemTypes": dict(sorted(types.items())),
        "projects": projects,
    }


def main(argv):
    path = argv[1] if len(argv) > 1 else SRC
    if not os.path.exists(path):
        sys.exit("source PDF not found: %s" % path)
    data, warnings = build(path)

    with open(os.path.join(BASE, "exam-items.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
    with open(os.path.join(BASE, "exam-items.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Generated by build_items.py - do not edit by hand.\n   Rebuild:  python build_items.py  */\n")
        fh.write("window.EXAM_DATA = ")
        fh.write(json.dumps(data, ensure_ascii=False))
        fh.write(";\n")

    app = app_schema(data)
    with open(os.path.join(BASE, "exam-data.json"), "w", encoding="utf-8") as fh:
        json.dump(app, fh, indent=1, ensure_ascii=False)
    with open(os.path.join(BASE, "exam-data.js"), "w", encoding="utf-8") as fh:
        fh.write("/* Generated by build_items.py from %s - do not edit by hand.\n"
                 "   Rebuild:  python build_items.py                          */\n" % data["source"])
        fh.write("window.DEFAULT_EXAM = ")
        fh.write(json.dumps(app, ensure_ascii=False))
        fh.write(";\n")

    print("source            : %s" % path)
    print("projects          : %d" % len(data["projects"]))
    for proj in data["projects"]:
        print("   %-34s %2d items  %3d min" % (proj["name"], proj["itemCount"], proj["duration"] // 60))
    print("items             : %d" % len(data["items"]))
    print("type distribution :")
    for kind, count in sorted(Counter(i["type"] for i in data["items"]).items()):
        print("   %-10s %d" % (kind, count))
    print("declared types in source:")
    for kind, count in sorted(Counter(i.get("declaredType") or "(none)" for i in data["items"]).items()):
        print("   %-22s %d" % (kind, count))
    weak = [i for i in data["items"] if i["type"] == "text"]
    print("plain-text fallback: %d %s" % (len(weak), [i.get("page") for i in weak]))
    broken = [i for i in data["items"] if i.get("parseError")]
    print("parse errors      : %d %s" % (len(broken), [i.get("page") for i in broken]))
    print("engine data       : exam-data.json + exam-data.js  (%d tasks, %d min)"
          % (sum(len(p["tasks"]) for p in app["projects"]), app["timeLimitMinutes"]))
    print("interactive       : %d of %d tasks"
          % (sum(1 for p in app["projects"] for t in p["tasks"] if t["item"]["type"] != "text"),
             sum(len(p["tasks"]) for p in app["projects"])))
    for w in warnings:
        print("  ! %s" % w)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
