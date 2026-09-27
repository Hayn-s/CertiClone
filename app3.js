"use strict";
/* CertiClone engine — part 3: workspace, study modal, summary, results. */
const DEFAULT_HTML = '<h1>Fruit</h1>\n<ol>\n  <li>Apple</li>\n  <li>Pear</li>\n  <li>Orange</li>\n</ol>\n<p>Edit this markup, press Run Preview, and practice each task.</p>';
const DEFAULT_CSS = 'body { font-family: Arial, sans-serif; margin: 20px; }\nh1 { color: #1f6fbf; }\nli { margin: 4px 0; }';
let codeFiles = { html: DEFAULT_HTML, css: DEFAULT_CSS }, curFile = "html", previewTimer = null;
function initWorkspace() {
  codeFiles = { html: DEFAULT_HTML, css: DEFAULT_CSS }; curFile = "html";
  setFileTab(); $("editor").value = codeFiles.html; renderPreview();
}
function setFileTab() {
  $("tab-html").classList.toggle("active", curFile === "html");
  $("tab-css").classList.toggle("active", curFile === "css");
}
function renderPreview() {
  const html = codeFiles.html, css = codeFiles.css;
  let doc;
  if (/<html[\s>]/i.test(html)) {
    doc = /<style/i.test(html) ? html : html.replace(/<\/head\s*>/i, "<style>" + css + "</style></head>");
  } else {
    doc = "<!DOCTYPE html><html><head><meta charset='utf-8'><style>" + css + "</style></head><body>" + html + "</body></html>";
  }
  $("preview").srcdoc = doc;
}
function statusIcon(s) {
  if (s.done && s.review) return "✔ ⚑";
  if (s.done) return "✔";
  if (s.review) return "⚑";
  if (s.viewed) return "👁";
  return "";
}
function openSummary() {
  const grid = $("sum-grid"); grid.innerHTML = "";
  exam.projects.forEach((p, pi) => {
    const box = document.createElement("div"); box.className = "sum-proj";
    const h = document.createElement("h4"); h.textContent = "Project " + (pi + 1) + ": " + p.projectName;
    box.appendChild(h);
    p.tasks.forEach((t, ti) => {
      const b = document.createElement("button"); b.className = "sum-task";
      const lab = document.createElement("span"); lab.textContent = "Task " + t.taskId;
      const ic = document.createElement("span"); ic.className = "st"; ic.textContent = statusIcon(st(pi, ti));
      b.appendChild(lab); b.appendChild(ic);
      b.onclick = () => { $("summary-screen").hidden = true; selectTask(pi, ti); updateProgress(); };
      box.appendChild(b);
    });
    grid.appendChild(box);
  });
  $("summary-screen").hidden = false;
}
function finishExam(timeUp) {
  stopTimer();
  $("summary-screen").hidden = true;
  $("study-modal").hidden = true;
  let done = 0, total = 0, flagged = 0, checked = 0, right = 0, points = 0;
  const lines = [];
  exam.projects.forEach((p, pi) => {
    let pd = 0;
    p.tasks.forEach((t, ti) => {
      total++; const s = st(pi, ti);
      if (s.done) { done++; pd++; }
      if (s.review) flagged++;
      if (s.result) { checked++; right += s.result.correct; points += s.result.total; }
    });
    lines.push("Project " + (pi + 1) + " (" + p.projectName + "): " + pd + "/" + p.tasks.length + " complete");
  });
  $("res-done").textContent = done;
  $("res-total").textContent = total;
  $("res-flag").textContent = flagged;
  $("res-score").textContent = points ? Math.round((right / points) * 100) + "%" : "–";
  $("res-time").textContent = fmtTime(elapsed);
  const d = $("res-detail"); d.innerHTML = "";
  const note = document.createElement("p");
  note.textContent = timeUp ? "Time expired — your session was submitted automatically." : "You finished the exam. Review your per-project breakdown below:";
  d.appendChild(note);
  const ul = document.createElement("ul");
  lines.forEach((ln) => { const li = document.createElement("li"); li.textContent = ln; ul.appendChild(li); });
  d.appendChild(ul);
  if (checked) {
    const sc = document.createElement("p");
    sc.textContent = "Checked answers: " + right + " of " + points + " graded points correct across " +
      checked + " checked task(s). Only tasks you pressed \u201cCheck Answer\u201d on are counted.";
    d.appendChild(sc);
  }
  $("results-screen").hidden = false;
}
function backToSetup() {
  stopTimer();
  $("exam-app").hidden = true;
  $("results-screen").hidden = true;
  $("summary-screen").hidden = true;
  $("setup-screen").style.display = "flex";
  initSetup();
}
document.addEventListener("DOMContentLoaded", () => {
  $("tab-html").onclick = () => { codeFiles[curFile] = $("editor").value; curFile = "html"; setFileTab(); $("editor").value = codeFiles.html; };
  $("tab-css").onclick = () => { codeFiles[curFile] = $("editor").value; curFile = "css"; setFileTab(); $("editor").value = codeFiles.css; };
  $("editor").addEventListener("input", () => {
    codeFiles[curFile] = $("editor").value;
    clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 700);
  });
  $("btn-run").onclick = () => { codeFiles[curFile] = $("editor").value; renderPreview(); };
  $("btn-reset-code").onclick = () => { codeFiles = { html: DEFAULT_HTML, css: DEFAULT_CSS }; $("editor").value = codeFiles[curFile]; renderPreview(); };
  $("study-btn").onclick = () => {
    const t = exam.projects[curP].tasks[curT];
    const box = $("study-answer");
    box.innerHTML = "";
    const lines = (window.Widgets && t.item) ? Widgets.summarize(t.item) : [];
    if (lines.length) {
      const h = document.createElement("div");
      h.className = "ans-head";
      h.textContent = "Answer key (" + (t.item.declaredType || t.item.type) + ")";
      box.appendChild(h);
      const ul = document.createElement("ul");
      ul.className = "ans-list";
      lines.forEach((ln) => { const li = document.createElement("li"); li.textContent = ln; ul.appendChild(li); });
      box.appendChild(ul);
    }
    const note = document.createElement("p");
    note.className = "src-note";
    note.textContent = "Published answer: " + t.correctAnswer + (t.ref ? "   ·   " + t.ref : "");
    box.appendChild(note);
    $("study-expl").textContent = t.explanation || "(No explanation provided for this task.)";
    $("study-modal").hidden = false;
  };
  $("study-close").onclick = () => { $("study-modal").hidden = true; };
  $("study-modal").addEventListener("click", (e) => { if (e.target === $("study-modal")) $("study-modal").hidden = true; });
  $("btn-summary").onclick = openSummary;
  $("sum-close").onclick = () => { $("summary-screen").hidden = true; };
  $("btn-return").onclick = () => { $("summary-screen").hidden = true; };
  $("btn-finish").onclick = () => finishExam(false);
  $("res-close").onclick = () => { $("results-screen").hidden = true; };
  $("btn-back-exam").onclick = () => { $("results-screen").hidden = true; };
  $("btn-restart-exam").onclick = () => startExam(exam);
  $("btn-new-data").onclick = backToSetup;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("study-modal").hidden = true; $("summary-screen").hidden = true; }
  });
});
