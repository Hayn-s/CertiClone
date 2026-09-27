"use strict";
/* CertiClone engine — part 2: dock rendering, task navigation, status toggles. */
function st(pi, ti) {
  const k = key(pi, ti);
  if (!state[k]) state[k] = { viewed: false, done: false, review: false };
  return state[k];
}
function renderAll() { renderProject(); selectTask(curP, curT, true); updateProgress(); }
function renderProject() {
  const p = exam.projects[curP];
  $("project-label").textContent = "Project " + (curP + 1) + " of " + exam.projects.length + " — " + p.projectName;
  $("ws-context").textContent = "Project " + (curP + 1) + ": " + p.projectName;
  const tabs = $("task-tabs"); tabs.innerHTML = "";
  p.tasks.forEach((t, ti) => {
    const b = document.createElement("button");
    b.className = "task-tab" + (ti === curT ? " active" : "");
    const label = document.createElement("span"); label.textContent = "Task " + t.taskId;
    const badge = document.createElement("span"); badge.className = "badge";
    const s = st(curP, ti);
    let icon = "";
    if (s.done) icon += "✔";
    if (s.review) icon += (icon ? " " : "") + "⚑";
    badge.textContent = icon;
    badge.classList.toggle("done", !!s.done);
    badge.classList.toggle("flag", !s.done && !!s.review);
    b.appendChild(label); b.appendChild(badge);
    b.title = "Task " + t.taskId + (s.done ? " (completed)" : "") + (s.review ? " (marked for review)" : "");
    b.onclick = () => selectTask(curP, ti);
    tabs.appendChild(b);
  });
  $("btn-prev").disabled = (curP === 0);
  $("btn-next").disabled = (curP === exam.projects.length - 1);
  $("btn-prev").style.opacity = curP === 0 ? 0.45 : 1;
  $("btn-next").style.opacity = curP === exam.projects.length - 1 ? 0.45 : 1;
}
function selectTask(pi, ti, keep) {
  curP = pi; curT = ti;
  st(pi, ti).viewed = true;
  const p = exam.projects[pi], t = p.tasks[ti];
  renderProject();
  $("task-label").textContent = "Task " + t.taskId;
  $("task-ref").textContent = t.ref ? ("· " + t.ref) : "";
  $("instruction-text").textContent = t.instruction;
  const s = st(pi, ti);
  mountItem(t, s);
  $("btn-review").classList.toggle("toggled-review", !!s.review);
  $("btn-complete").classList.toggle("toggled-done", !!s.done);
  $("study-modal").hidden = true;
  if (!keep) updateProgress();
}
/* ---------- interactive question widget (rendered by widgets.js) ---------- */
let curApi = null, wideManual = false;
const WIDE_TYPES = ["sequence", "match", "dropblank", "hotarea", "groupchoice", "fillblank", "multi"];
function mountItem(t, s) {
  const host = $("item-host"), bar = $("item-bar");
  curApi = null;
  host.innerHTML = "";
  delete s.resp; s.resultLive = false;                 // built answer is per-visit; the grade is kept
  if (window.Widgets && t.item && t.item.type !== "text") {
    try {
      curApi = Widgets.render(t, host, { onChange: () => { s.resultLive = false; setFeedback(s); } });
    } catch (e) {
      const p = document.createElement("p");
      p.className = "wx-hint";
      p.textContent = "This question could not be made interactive (" + e.message + "). Use Study Mode for the answer.";
      host.appendChild(p);
      curApi = null;
    }
  }
  bar.hidden = !curApi;
  applyWide();
  setFeedback(s);
}
function applyWide() {
  const wide = wideManual || !!(curApi && WIDE_TYPES.indexOf(curApi.type) >= 0);
  document.body.classList.toggle("wide", wide);
  $("btn-wide").textContent = wide ? "Narrow Question" : "Widen Question";
}
function setFeedback(s) {
  const box = $("item-feedback");
  const r = s && s.result;
  if (!r) { box.textContent = ""; box.className = "verdict"; return; }
  if (!s.resultLive) {                       // kept for the results screen, but no longer on screen
    box.textContent = "Last check: " + r.correct + " / " + r.total + (r.full ? "  — correct" : "");
    box.className = "verdict stale";
    return;
  }
  box.textContent = r.correct + " / " + r.total + (r.full ? "  — correct" : "  — see the marks on the item");
  box.className = "verdict " + (r.full ? "ok" : "no");
}
function checkItem() {
  const t = exam.projects[curP].tasks[curT], s = st(curP, curT);
  if (!curApi || !window.Widgets || !t.item) return;
  s.resp = curApi.getResp();
  s.result = Widgets.grade(t.item, s.resp);
  s.resultLive = true;
  curApi.reveal();
  if (s.result.full && !s.done) toggleComplete();
  setFeedback(s);
}
function clearItem() {
  const s = st(curP, curT);
  if (curApi) curApi.reset();
  delete s.resp; s.resultLive = false;
  setFeedback(s);
}
function toggleReview() {
  const s = st(curP, curT); s.review = !s.review; s.viewed = true;
  renderProject(); updateProgress();
  $("btn-review").classList.toggle("toggled-review", !!s.review);
}
function toggleComplete() {
  const s = st(curP, curT); s.done = !s.done; s.viewed = true;
  renderProject(); updateProgress();
  $("btn-complete").classList.toggle("toggled-done", !!s.done);
}
function restartProject() {
  exam.projects[curP].tasks.forEach((t, ti) => { state[key(curP, ti)] = { viewed: false, done: false, review: false }; });
  selectTask(curP, 0); updateProgress();
}
function gotoProject(n) {
  if (n < 0 || n >= exam.projects.length) return;
  curP = n; curT = 0;
  selectTask(curP, curT); updateProgress();
}
function updateProgress() {
  let done = 0, total = 0;
  exam.projects.forEach((p, pi) => p.tasks.forEach((t, ti) => { total++; if (st(pi, ti).done) done++; }));
  $("progressbar").firstElementChild.style.width = (total ? (done / total * 100) : 0) + "%";
}
document.addEventListener("DOMContentLoaded", () => {
  $("btn-review").onclick = toggleReview;
  $("btn-complete").onclick = toggleComplete;
  $("btn-restart").onclick = restartProject;
  $("btn-prev").onclick = () => gotoProject(curP - 1);
  $("btn-next").onclick = () => gotoProject(curP + 1);
  $("btn-check").onclick = checkItem;
  $("btn-clear-item").onclick = clearItem;
  $("btn-wide").onclick = () => { wideManual = !wideManual; applyWide(); };
});
