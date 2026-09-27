/* Headless check of widgets.js grading + data integrity (node _wtest.js) */
const path = require("path");
const W = require(path.join(__dirname, "widgets.js"));
const data = require(path.join(__dirname, "exam-data.json"));

function perfect(item) {
  switch (item.type) {
    case "choice": case "multi": return { answers: item.answer.slice() };
    case "yesno": return { answers: item.answer.slice() };
    case "sequence": return { order: item.answer.slice() };
    case "match": {
      const p = {};
      item.tokens.forEach(t => { if (t.zone) p[t.id] = t.zone; });
      return { placements: p };
    }
    case "dropblank": case "hotarea":
      if (item.graphic || (!item.blanks && item.options)) return { answers: item.answer.slice() };
      return { filled: Object.fromEntries(item.blanks.map(b => [b.id, b.answer])) };
    case "groupchoice": return { picks: item.answer.slice() };
    case "fillblank": return { texts: Object.fromEntries(item.blanks.map(b => [b.id, b.answer])) };
    default: return {};
  }
}
function broken(item) {                       // deliberately wrong answers
  switch (item.type) {
    case "choice": case "multi": return { answers: (item.options || []).map(o => o.id).slice(-1) };
    case "yesno": return { answers: item.answer.map(a => (a === "Yes" ? "No" : "Yes")) };
    case "sequence": return { order: item.answer.slice().reverse() };
    case "match": {
      const zs = item.zones.map(z => z.id);
      const p = {};
      item.tokens.forEach((t, i) => { if (t.zone) p[t.id] = zs[(zs.indexOf(t.zone) + 1) % zs.length]; });
      return { placements: p };
    }
    case "dropblank": case "hotarea":
      if (item.graphic || (!item.blanks && item.options)) return { answers: ["__none__"] };
      return { filled: Object.fromEntries(item.blanks.map(b => [b.id, "???"])) };
    case "groupchoice": return { picks: item.answer.map(() => "???") };
    case "fillblank": return { texts: Object.fromEntries(item.blanks.map(b => [b.id, "???"])) };
    default: return {};
  }
}

let bad = [], kinds = {}, empty = [];
for (const p of data.projects) {
  for (const t of p.tasks) {
    const it = t.item;
    kinds[it.type] = (kinds[it.type] || 0) + 1;
    if (it.type === "text") continue;
    try {
      const good = W.grade(it, perfect(it));
      const wrong = W.grade(it, broken(it));
      const sum = W.summarize(it);
      if (good.ratio !== 1) bad.push([t.ref, it.type, "perfect scores " + good.ratio, good.lines.filter(l => !l.ok).slice(0, 2)]);
      if (wrong.ratio >= 1) bad.push([t.ref, it.type, "wrong answer scores " + wrong.ratio]);
      if (!sum.length) empty.push(t.ref);
      if (!it.prompt || !it.prompt.length) empty.push(t.ref + " (no prompt)");
    } catch (e) {
      bad.push([t.ref, it.type, "THREW " + e.message]);
    }
  }
}
console.log("type counts :", kinds);
console.log("grade failures:", bad.length);
bad.slice(0, 12).forEach(b => console.log("  !", JSON.stringify(b)));
console.log("missing answer-summary/prompt:", empty.length, empty.slice(0, 8));
console.log("sample yesno summary:", W.summarize(data.projects.flatMap(p => p.tasks).find(t => t.item.type === "yesno").item));
