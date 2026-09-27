"use strict";
/* CertiClone engine — part 1: state, schema validation, setup screen, timer. */
const $ = (id) => document.getElementById(id);
const SAMPLE_EXAM = {
  examTitle: "Database & Spreadsheet Fundamentals",
  timeLimitMinutes: 50,
  projects: [{
    projectId: 1, projectName: "Inventory Management",
    tasks: [
      { taskId: 1, instruction: "Format the cell range A1:F1 as a table with headers.",
        correctAnswer: "Select A1:F1 -> Home Tab -> Format as Table -> Choose a style -> Check 'My table has headers'.",
        explanation: "Formatting as a table allows for dynamic sorting and filtering, essential for monitoring profits and inventory." },
      { taskId: 2, instruction: "Create a database trigger that updates the 'LastModified' column when a row is edited.",
        correctAnswer: "Write an AFTER UPDATE trigger on the table targeting the LastModified column.",
        explanation: "Triggers automate data integrity checks without application-level code, keeping business rules intact." }
    ]
  }]
};
let exam = null, curP = 0, curT = 0, state = {};
let totalSecs = 0, remaining = 0, timerId = null, elapsed = 0;
const key = (pi, ti) => pi + ":" + ti;
function normalizeExam(input) {
  let obj;
  if (Array.isArray(input)) obj = { examTitle: "Custom Reviewer Exam", timeLimitMinutes: 50, projects: input };
  else if (input && typeof input === "object") obj = input;
  else throw new Error("JSON must be an object or an array of projects.");
  if (!Array.isArray(obj.projects)) throw new Error('Missing "projects" array.');
  const out = {
    examTitle: String(obj.examTitle || "Custom Reviewer Exam"),
    timeLimitMinutes: Math.max(1, parseInt(obj.timeLimitMinutes || 50, 10) || 50),
    projects: obj.projects.map((p, i) => ({
      projectId: (p.projectId != null ? p.projectId : i + 1),
      projectName: String(p.projectName || ("Project " + (i + 1))),
      tasks: (Array.isArray(p.tasks) ? p.tasks : []).map((t, j) => ({
        taskId: (t.taskId != null ? t.taskId : j + 1),
        instruction: String(t.instruction || "(no instruction provided)"),
        correctAnswer: String(t.correctAnswer || "(no answer provided)"),
        explanation: String(t.explanation || ""),
        ref: String(t.ref || ""),
        item: (t.item && typeof t.item === "object" && t.item.type) ? t.item : null
      }))
    })).filter((p) => p.tasks.length > 0)
  };
  if (!out.projects.length) throw new Error("No projects containing tasks were found.");
  return out;
}
function countTasks(ex) { return ex.projects.reduce((n, p) => n + p.tasks.length, 0); }
function countInteractive(ex) {
  return ex.projects.reduce((n, p) => n + p.tasks.filter((t) => t.item && t.item.type && t.item.type !== "text").length, 0);
}
function showError(msg) { const e = $("setup-error"); e.style.display = "block"; e.textContent = msg; }
function clearError() { const e = $("setup-error"); e.style.display = "none"; e.textContent = ""; }
function defaultExam() {
  if (typeof window.DEFAULT_EXAM !== "undefined") { try { return normalizeExam(window.DEFAULT_EXAM); } catch (e) { /* fall through */ } }
  return normalizeExam(SAMPLE_EXAM);
}
function initSetup() {
  let info = null;
  try { info = defaultExam(); } catch (e) { info = normalizeExam(SAMPLE_EXAM); }
  $("setup-stats").innerHTML = "";
  const stats = [
    ["Exam", info.examTitle], ["Projects", info.projects.length],
    ["Tasks", countTasks(info)], ["Time", info.timeLimitMinutes + " min"]
  ];
  if (countInteractive(info)) stats.push(["Interactive", countInteractive(info)]);
  stats.forEach((s) => {
    const d = document.createElement("div"); d.className = "stat";
    d.innerHTML = ""; const b = document.createElement("b"); b.textContent = String(s[1]);
    d.appendChild(b); d.appendChild(document.createTextNode(" " + s[0]));
    $("setup-stats").appendChild(d);
  });
  $("schema-pre").textContent = JSON.stringify(SAMPLE_EXAM, null, 2);
  $("btn-start-default").onclick = () => { clearError(); try { startExam(defaultExam()); } catch (e) { showError("Default data error: " + e.message); } };
  $("file-input").onchange = (ev) => {
    clearError();
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { startExam(normalizeExam(JSON.parse(r.result))); } catch (e) { showError("Invalid JSON file: " + e.message); } };
    r.onerror = () => showError("Could not read that file.");
    r.readAsText(f); ev.target.value = "";
  };
  $("btn-load-sample").onclick = () => { clearError(); $("paste-area").value = JSON.stringify(SAMPLE_EXAM, null, 2); };
  $("btn-use-pasted").onclick = () => {
    clearError();
    const txt = $("paste-area").value.trim();
    if (!txt) { showError("Paste your exam JSON first."); return; }
    try { startExam(normalizeExam(JSON.parse(txt))); }
    catch (e) { showError("Invalid pasted JSON: " + e.message); }
  };
}
function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}
function startTimer() {
  stopTimer();
  $("timer").textContent = fmtTime(remaining);
  $("timer").classList.toggle("low", remaining <= 300);
  timerId = setInterval(() => {
    remaining -= 1; elapsed += 1;
    if (remaining <= 0) { remaining = 0; $("timer").textContent = fmtTime(0); finishExam(true); return; }
    $("timer").textContent = fmtTime(remaining);
    $("timer").classList.toggle("low", remaining <= 300);
  }, 1000);
}
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
function startExam(data) {
  exam = data; curP = 0; curT = 0; state = {};
  totalSecs = exam.timeLimitMinutes * 60; remaining = totalSecs; elapsed = 0;
  $("setup-screen").style.display = "none";
  $("exam-app").hidden = false;
  $("results-screen").hidden = true;
  $("summary-screen").hidden = true;
  $("study-modal").hidden = true;
  $("exam-name").textContent = "— " + exam.examTitle;
  initWorkspace();
  renderAll();
  startTimer();
}
document.addEventListener("DOMContentLoaded", initSetup);
