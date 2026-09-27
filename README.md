# CertiClone — Compass Study Simulator

A web-based study simulator that clones the **Certiport Compass** project-based exam
engine and renders a real question bank as **interactive item types**.
**Study tool only — no lockdown, proctoring, or fullscreen.**

## Run it

Double-click **`index.html`** (works over `file://`, no server or build step), or serve
the folder:

```
python -m http.server 8000      # then open http://localhost:8000
```

## Files

| File | Purpose |
|---|---|
| `index.html` | All screens: setup, 70/30 exam split, item host, study modal, summary, results |
| `styles.css` / `styles2.css` | Setup screen + workspace CSS / Compass dock + modal CSS |
| `styles3.css` | Item widgets (all `wx-*` states), Check-Answer bar, wide mode, summary/results extras |
| `app.js` | Setup screen, JSON schema validation (incl. `item` blocks), timer, exam-level stats |
| `app2.js` | Project/task rendering, mounting the question widget, Check/Clear/Widen, Review/Complete |
| `app3.js` | Mock HTML/CSS workspace, study modal (answer key + published answer), summary, results |
| `widgets.js` | **Item-type engine**: renders/grades every question type, reveals right/wrong in place |
| `exam-data.json` | Default exam data — **60 items from EXAM_A_B_F_Q1-Q56.pdf**, 6 projects |
| `exam-data.js` | Same data as a `window.DEFAULT_EXAM` script (so `file://` works too) |
| `build_items.py` | PDF → `exam-data.*` parser (reviewer format, per-type extractors) |
| `check_items.py` | Data-contract test: every item matches what `widgets.js` expects |
| `check_syntax.py` | Structure test: brace balance + renderer/API shape of every script |
| `check_wiring.py` | Static test: every `$("id")` exists in `index.html`, every widget class has CSS |
| `test_widgets.js` | Grader round-trip test (`node test_widgets.js`) — needs Node |

## Question types

`build_items.py` classifies each source question and emits a structured `item`;
`widgets.js` renders it. **54 of the 60 bundled tasks are interactive**, 6 stay as
text (their answer area is an image in the source PDF — those are labelled).

| `item.type` | Rendered as | Grading / reveal | Count |
|---|---|---|---|
| `choice` | lettered single-select list | correct option outlined green, yours red if wrong | 19 |
| `multi` | checkbox list | per-option ✓ / ✗, count of correct vs chosen | 1 |
| `yesno` | Yes / No buttons (multi-part = a grid with one button per row) | per-cell marks | 2 |
| `hotarea` | click a region of the mock page (SVG), or a choice-style list | correct region glows | 7 |
| `sequence` | drag/click reorder list (or ordered slots when the order is derived) | slot shows its rank vs the key | 8 |
| `match` | term pool + target slots, click-pair or drag | per-slot ✓ / ✗ | 5 |
| `dropblank` | text with inline blanks + token pool | per-blank ✓ / ✗ | 9 |
| `fillblank` | inline text inputs (typed answer) | per-blank ✓ / ✗, shows the expected text | 1 |
| `groupchoice` | one option list per group box | per-group verdicts | 2 |
| `text` | instruction + code excerpt only | use Study Mode for the published answer | 6 |

**How grading works:** nothing is validated while you click. Press **Check Answer** and
every part is marked in place (green = correct, red = your wrong pick, dashed outline =
the correct one), with a `7 / 10` verdict in the bar. **Clear** resets the item,
**Widen Question** (automatic for wide item types, and manual otherwise) gives the
question pane ~58% of the window. Correct answers are **never** shown before you check —
they are revealed only by Check Answer or by the **Show Answer** study modal, which also
prints a structured answer key for the item type plus the published answer text.

## Regenerating the bundled data

```
python build_items.py                       # uses ..\HTML EXAM\EXAM_A_B_F_Q1-Q56.pdf
python build_items.py path\to\other.pdf     # any other reviewer PDF in the same format
```

It prints the per-type distribution, the declared types seen in the source, which items
fell back to plain text, and any parse errors — then writes `exam-data.json` +
`exam-data.js`. Items the reviewer PDF cannot express (multi-select, term matching,
typed fill-in-the-blank, graphic hot-spot) come from the `AUTHORED` list inside the
script and are flagged `"authored": true`; the UI labels them so they are not mistaken
for source questions.

## Checks

```
python check_items.py       # data contract: 60 tasks / 6 projects, 0 problems
python check_wiring.py      # DOM ids + CSS classes referenced by the JS all exist
node test_widgets.js        # every item: the right answer scores 100%, a wrong one does not
```

## Features

- Rigid unscrollable full-page layout: 70% mock workspace / 30% Compass dock
- Header bar: `Project X of Y — name` + countdown timer (red under 5 min)
- Task tabs with ✔ / ⚑ badges, instruction panel, interactive item, Check Answer bar
- Real exam interaction for every item type: click, type, drag-and-drop, reorder
- Action bar: Restart Project, Mark for Review, Mark Complete, Summary, Prev/Next Project
- Summary overlay: Unseen / Viewed (👁) / Completed (✔) / Review (⚑), click to jump
- Results screen: per-project breakdown, checked-answer score, elapsed time
- Setup screen still accepts pasted/uploaded JSON (a bare array of projects works too)

## Limitations

- The JS runs in the browser only — this workspace has no Node/JS runtime, so `widgets.js`
  was validated through `check_items.py` (data contract), `check_wiring.py` (DOM/CSS) and
  a branch-by-branch review of `grade()`; run `node test_widgets.js` locally for the
  executable round-trip test.
- The built-in mock editor is HTML/CSS only; other exam domains stay on the dock path.
- 6 items (pages 33, 42, 48, 51, 54, 56) and any `unavailable: true` item keep their
  answer in a PDF screenshot, so they render as text plus the published answer.
- 4 sequence items are marked `"derived": true` (the source lists steps as plain text with
  no confirmed key) and some hot-spot items ship their region list without verifiable
  click targets — both are labelled in the UI and graded from the published key.
- Answers you built live while you stay on a task; leaving the task rebuilds a blank widget
  and the bar falls back to a muted `Last check: 7 / 10`, which is also what the results
  screen scores from. There is no persistence across a page reload (nothing is stored).
- `wrongAnswer` / `points` are not present in the source PDF, so they stay empty and
  grading is unweighted (one point per graded part).

