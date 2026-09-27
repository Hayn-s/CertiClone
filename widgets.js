"use strict";
/* CertiClone widgets - interactive item renderers + pure grading helpers.
 *
 * Consumes the `item` payload produced by build_items.py (see WIDGET_KEYS there):
 *   choice / multi      {options:[{id,text}], answer:[id]}
 *   yesno               {statements:[text], answer:["Yes"|"No"]}
 *   sequence            {blocks:[text], answer:[text], preview, derived}
 *   match               {zones:[{id,label}], tokens:[{id,text,zone}]}
 *   dropblank/hotarea   {template:[{text}|{blank:n}], blanks:[{id,options,answer}], pool:[text], reusable}
 *   hotarea (graphic)   {graphic:{viewBox,regions:[{id,x,y,w,h,label}]}, options, answer:[id]}
 *   groupchoice         {groups:[{label,options}], answer:[text]}
 *   fillblank           {template:[...], blanks:[{id,accept|answer}]}
 *   text                {unavailable?}          -> study-only item (image answer area)
 *
 * grade()/summarize() are pure (no DOM) so they can be exercised from node.
 */
(function (global) {
  var Widgets = {};

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function code(text, cls) {
    var n = el("pre", "wx-code" + (cls ? " " + cls : ""));
    n.textContent = text;
    return n;
  }
  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase().replace(/:$/, "");
  }
  function eqList(a, b) {
    if (a.length !== b.length) return false;
    var x = a.map(norm).slice().sort(), y = b.map(norm).slice().sort();
    return x.every(function (v, i) { return v === y[i]; });
  }
  /* deterministic shuffle: the same task always shows the same scrambled order */
  function seeded(seedStr, arr) {
    var h = 2166136261, i, out = arr.slice();
    seedStr = String(seedStr);
    for (i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = (h * 16777619) >>> 0; }
    for (i = out.length - 1; i > 0; i--) {
      h = (h * 1103515245 + 12345) >>> 0;
      var j = h % (i + 1), t = out[i];
      out[i] = out[j]; out[j] = t;
    }
    return out;
  }
  function zoneLabel(item, zid) {
    var z = (item.zones || []).filter(function (x) { return x.id === zid; })[0];
    return z ? z.label : "(unplaced)";
  }

  /* ---------- pure grading: grade(item, response) ---------- */
  Widgets.grade = function (item, resp) {
    resp = resp || {};
    var out = { ratio: 0, correct: 0, total: 0, full: false, lines: [] };
    if (!item) return out;
    function push(label, ok, given, want) {
      out.total += 1;
      if (ok) out.correct += 1;
      out.lines.push({ label: label, ok: !!ok, given: given || "(none)", want: want || "" });
    }
    var want, got, hits, wrong, wantText;

    if (item.type === "choice" || item.type === "multi" ||
        (item.type === "hotarea" && (item.graphic || (!item.blanks && item.options)))) {
      want = (item.answer || []).map(norm);
      got = (resp.answers || []).map(norm);
      hits = got.filter(function (g) { return want.indexOf(g) >= 0; }).length;
      wrong = got.length - hits;
      out.total = Math.max(1, want.length);
      out.correct = Math.max(0, hits - wrong);
      out.full = want.length > 0 && eqList(got, want);
      wantText = want.map(function (w) {
        var o = (item.options || []).filter(function (x) { return norm(x.id) === w; })[0];
        return o ? (o.id + ". " + o.text) : w;
      });
      out.lines = (wantText.length ? wantText : ["(no answer recorded in source)"]).map(function (t) {
        return { label: "Correct answer", ok: out.full, given: got.length ? got.join(", ") : "(none)", want: t };
      });
      out.ratio = out.total ? Math.round((out.correct / out.total) * 100) / 100 : 0;
      return out;
    }
    if (item.type === "yesno") {
      (item.statements || []).forEach(function (s, i) {
        var w = (item.answer || [])[i];
        push("Statement " + (i + 1), w != null && (resp.answers || [])[i] === w, (resp.answers || [])[i], w);
      });
    } else if (item.type === "sequence") {
      (item.answer || []).forEach(function (b, i) {
        push("Position " + (i + 1), norm((resp.order || [])[i]) === norm(b), (resp.order || [])[i], b);
      });
    } else if (item.type === "match") {
      (item.tokens || []).forEach(function (t) {
        if (!t.zone) { push(t.text, !(resp.placements || {})[t.id], "placed", "left in the pool (extra term)"); return; }
        var g = (resp.placements || {})[t.id];
        push(t.text, !!g && norm(g) === norm(t.zone), zoneLabel(item, g), zoneLabel(item, t.zone));
      });
    } else if (item.type === "dropblank" || item.type === "hotarea") {
      (item.blanks || []).forEach(function (b) {
        var g = (resp.filled || {})[b.id];
        push("Blank " + b.id, !!g && norm(g) === norm(b.answer), g, b.answer);
      });
    } else if (item.type === "groupchoice") {
      (item.groups || []).forEach(function (g, i) {
        var w = (item.answer || [])[i];
        push(g.label, norm((resp.picks || [])[i]) === norm(w), (resp.picks || [])[i], w);
      });
    } else if (item.type === "fillblank") {
      (item.blanks || []).forEach(function (b) {
        var accept = (b.accept && b.accept.length ? b.accept : [b.answer]).map(norm);
        var g = (resp.texts || {})[b.id];
        push("Blank " + b.id, accept.indexOf(norm(g)) >= 0, g, b.answer);
      });
    }
    out.ratio = out.total ? Math.round((out.correct / out.total) * 100) / 100 : 0;
    out.full = out.total > 0 && out.correct === out.total;
    return out;
  };


  /* correct answer as readable lines (Study Mode) */
  Widgets.summarize = function (item) {
    if (!item) return [];
    var lines = [];
    if (item.type === "choice" || item.type === "multi" ||
        (item.type === "hotarea" && (item.graphic || (!item.blanks && item.options)))) {
      (item.answer || []).forEach(function (a) {
        var o = (item.options || []).filter(function (x) { return x.id === a; })[0];
        lines.push(o ? o.id + ". " + o.text : String(a));
      });
    } else if (item.type === "yesno") {
      (item.statements || []).forEach(function (s, i) {
        lines.push((i + 1) + ". " + s + "  ->  " + ((item.answer || [])[i] || "?"));
      });
    } else if (item.type === "sequence") {
      (item.answer || []).forEach(function (b, i) { lines.push((i + 1) + ". " + String(b).replace(/\s+/g, " ")); });
    } else if (item.type === "match") {
      (item.tokens || []).forEach(function (t) {
        lines.push(t.text + "  ->  " + (t.zone ? zoneLabel(item, t.zone) : "(not used - extra term)"));
      });
    } else if (item.type === "dropblank" || item.type === "hotarea") {
      (item.blanks || []).forEach(function (b) { lines.push("Blank " + b.id + ":  " + b.answer); });
    } else if (item.type === "groupchoice") {
      (item.groups || []).forEach(function (g, i) {
        lines.push(g.label + "  ->  " + ((item.answer || [])[i] || "?"));
      });
    } else if (item.type === "fillblank") {
      (item.blanks || []).forEach(function (b) { lines.push("Blank " + b.id + ":  " + b.answer); });
    }
    if (item.partial) lines.push("(Only part of the original answer area was machine-readable in the source PDF.)");
    if (item.derived) lines.push("(The source PDF shows this answer area as an image; the ordering task was rebuilt from the published solution.)");
    return lines;
  };

  /* ---------- shared drag/click plumbing ---------- */
  function pickable(node, payload) {
    node.draggable = true;
    node.dataset.wxp = payload;
    node.addEventListener("dragstart", function (ev) {
      ev.dataTransfer.setData("text/plain", payload);
      ev.dataTransfer.effectAllowed = "move";
    });
  }
  function droppable(node, onDrop) {
    node.addEventListener("dragover", function (ev) { ev.preventDefault(); node.classList.add("wx-hot"); });
    node.addEventListener("dragleave", function () { node.classList.remove("wx-hot"); });
    node.addEventListener("drop", function (ev) {
      ev.preventDefault();
      node.classList.remove("wx-hot");
      onDrop(ev.dataTransfer.getData("text/plain"), ev);
    });
  }

  /* ---------- prompt (question text + code exhibits) ---------- */
  function promptInto(item, host) {
    (item.prompt || []).forEach(function (p) {
      host.appendChild(p.kind === "code" ? code(p.text) : el("p", "wx-p", p.text));
    });
    if (item.code) host.appendChild(code(item.code));
  }
  function badgeInto(item, host) {
    var b = el("div", "wx-kind", (item.declaredType || item.type) +
      (item.source ? "  \u00b7  source " + item.source : ""));
    if (item.authored) b.className += " authored";
    host.appendChild(b);
  }

  /* ---------- multiple choice / multiple select ---------- */
  function renderChoice(item, host, ctx) {
    var multi = item.type === "multi" || (item.answer || []).length > 1;
    var wrap = el("div", "wx-opts");
    function answers() {
      return Array.prototype.slice.call(wrap.querySelectorAll("input"))
        .filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
    }
    function marks() {
      var got = answers();
      (item.options || []).forEach(function (o, i) {
        var row = wrap.children[i];
        var want = (item.answer || []).indexOf(o.id) >= 0, has = got.indexOf(o.id) >= 0;
        row.classList.toggle("wx-right", want);
        row.classList.toggle("wx-wrong", has && !want);
      });
    }
    (item.options || []).forEach(function (o) {
      var row = el("label", "wx-opt");
      var inp = el("input");
      inp.type = multi ? "checkbox" : "radio";
      inp.name = "wx-" + ctx.seed;
      inp.value = o.id;
      inp.addEventListener("change", function () { ctx.onChange(); marks(); });
      row.appendChild(inp);
      row.appendChild(el("b", "wx-key", o.id));
      row.appendChild(el("span", "wx-txt", o.text));
      droppable(row, function (id) {
        if (id === o.id) { inp.checked = true; ctx.onChange(); marks(); }
      });
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
    if (multi) host.appendChild(el("p", "wx-hint", "Select every option that applies."));
    return {
      getResp: function () { return { answers: answers() }; },
      reveal: function () {
        (item.options || []).forEach(function (o, i) {
          wrap.children[i].querySelector("input").checked = (item.answer || []).indexOf(o.id) >= 0;
        });
        marks();
      },
      clear: function () {
        Array.prototype.forEach.call(wrap.querySelectorAll("input"), function (i) { i.checked = false; });
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove("wx-right", "wx-wrong"); });
      }
    };
  }


  /* ---------- drag / click sequence (reorder the code) ---------- */
  function renderSequence(item, host, ctx) {
    var blocks = item.blocks || item.answer || [];
    var slots = (item.answer || []).length || blocks.length;
    var poolBox = el("div", "wx-pool"), lineBox = el("div", "wx-seq");
    var placed = [];                                       // block text per slot (null = empty)
    host.appendChild(el("p", "wx-hint",
      "Put the segments in the correct order: click a segment (or drag it) into a slot, click a placed segment to send it back."));
    for (var i = 0; i < slots; i++) {
      var slot = el("div", "wx-slot");
      placed.push(null);
      (function (idx) {
        droppable(slot, function (txt) { put(idx, decodeURIComponent(txt || "")); });
        slot.addEventListener("click", function () { if (placed[idx] != null) take(idx); });
      })(i);
      lineBox.appendChild(slot);
    }
    host.appendChild(lineBox);
    host.appendChild(poolBox);

    function find(txt) {
      return Array.prototype.slice.call(poolBox.children).filter(function (n) { return n.textContent === txt; })[0];
    }
    function token(txt) {
      var b = el("button", "wx-token", txt);
      b.type = "button";
      pickable(b, encodeURIComponent(txt));
      b.addEventListener("click", function () {
        var free = placed.indexOf(null);
        if (free < 0) return;
        put(free, txt);
      });
      return b;
    }
    seeded(ctx.seed, blocks).forEach(function (t) { poolBox.appendChild(token(t)); });

    function put(idx, txt) {
      var node = find(txt);
      if (!node) return;
      if (placed[idx] != null) take(idx, true);
      placed[idx] = txt;
      poolBox.removeChild(node);
      paint();
      ctx.onChange();
    }
    function take(idx, silent) {
      var txt = placed[idx];
      if (txt == null) return;
      placed[idx] = null;
      poolBox.appendChild(token(txt));
      paint();
      if (!silent) ctx.onChange();
    }
    function paint() {
      Array.prototype.forEach.call(lineBox.children, function (node, idx) {
        node.textContent = (idx + 1) + (placed[idx] == null ? "   \u00b7   empty" : "   " + placed[idx]);
        node.className = "wx-slot" + (placed[idx] == null ? "" : " wx-filled") +
          (node.dataset.state ? " " + node.dataset.state : "");
      });
    }
    function marks() {
      (item.answer || []).forEach(function (want, idx) {
        var node = lineBox.children[idx];
        if (!node) return;
        var ok = norm(placed[idx]) === norm(want);
        node.classList.toggle("wx-right", ok);
        node.classList.toggle("wx-wrong", !ok);
      });
    }
    paint();
    return {
      getResp: function () { return { order: placed.slice() }; },
      reveal: function () {
        placed = (item.answer || []).slice();
        (item.answer || []).forEach(function (t) { var n = find(t); if (n) poolBox.removeChild(n); });
        paint();
        marks();
      },
      clear: function () {
        placed = [];
        for (var k = 0; k < slots; k++) placed.push(null);
        poolBox.innerHTML = "";
        seeded(ctx.seed, blocks).forEach(function (t) { poolBox.appendChild(token(t)); });
        paint();
      }
    };
  }

  /* ---------- Yes / No statement grid ---------- */
  function renderYesNo(item, host, ctx) {
    var table = el("table", "wx-grid"), boxes = [];
    var head = el("tr");
    ["Statement", "Yes", "No"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    table.appendChild(head);
    (item.statements || []).forEach(function (s, i) {
      var tr = el("tr"), row = {};
      tr.appendChild(el("td", "wx-st", s));
      ["Yes", "No"].forEach(function (v) {
        var td = el("td", "wx-cell"), inp = el("input");
        inp.type = "radio";
        inp.name = "wx-yn-" + ctx.seed + "-" + i;
        inp.value = v;
        inp.addEventListener("change", function () { ctx.onChange(); marks(); });
        td.appendChild(inp);
        tr.appendChild(td);
        row[v] = { td: td, inp: inp };
      });
      boxes[i] = row;
      table.appendChild(tr);
    });
    host.appendChild(table);
    function current() {
      return boxes.map(function (r) {
        return r && r.Yes.inp.checked ? "Yes" : (r && r.No.inp.checked ? "No" : undefined);
      });
    }
    function marks() {
      (item.answer || []).forEach(function (w, i) {
        var r = boxes[i];
        if (!r) return;
        ["Yes", "No"].forEach(function (v) {
          r[v].td.classList.toggle("wx-right", v === w);
          r[v].td.classList.toggle("wx-wrong", r[v].inp.checked && v !== w);
        });
      });
    }
    return {
      getResp: function () { return { answers: current() }; },
      reveal: function () {
        (item.answer || []).forEach(function (w, i) { if (boxes[i] && boxes[i][w]) boxes[i][w].inp.checked = true; });
        marks();
      },
      clear: function () {
        boxes.forEach(function (r) {
          if (!r) return;
          ["Yes", "No"].forEach(function (v) {
            r[v].inp.checked = false;
            r[v].td.classList.remove("wx-right", "wx-wrong");
          });
        });
      }
    };
  }


  /* ---------- matching table (drag term -> target row) ---------- */
  function renderMatch(item, host, ctx) {
    var poolBox = el("div", "wx-pool"), zoneBox = el("div", "wx-zones");
    var place = {};                                        // tokenId -> zoneId
    var selected = null;
    var byId = {};
    (item.tokens || []).forEach(function (t) { byId[t.id] = t; });
    host.appendChild(el("p", "wx-hint",
      "Drag (or click) each term onto the row it belongs to. Extra terms must stay in the pool."));

    function buildZones() {
      zoneBox.innerHTML = "";
      (item.zones || []).forEach(function (z) {
        var row = el("div", "wx-zone");
        row.dataset.zone = z.id;
        row.appendChild(el("div", "wx-zone-label", z.label));
        row.appendChild(el("div", "wx-hold"));
        droppable(row, function (id) { drop(id, z.id); });
        row.addEventListener("click", function (ev) {
          if (ev.target.classList.contains("wx-token")) return;
          if (selected) drop(selected, z.id);
        });
        zoneBox.appendChild(row);
      });
    }
    function tok(id, txt) {
      var b = el("button", "wx-token", txt);
      b.type = "button";
      b.dataset.tok = id;
      pickable(b, id);
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (b.parentNode === poolBox) {
          selected = (selected === id ? null : id);
          paintSel();
        } else {                                  // click a placed term -> back to the pool
          delete place[id];
          poolBox.appendChild(b);
          paint();
          ctx.onChange();
        }
      });
      return b;
    }
    function buildPool() {
      poolBox.innerHTML = "";
      seeded(ctx.seed, item.tokens || []).forEach(function (t) { poolBox.appendChild(tok(t.id, t.text)); });
    }
    buildZones();
    buildPool();
    host.appendChild(zoneBox);
    host.appendChild(poolBox);

    function nodeFor(id) {
      return Array.prototype.slice.call(host.querySelectorAll(".wx-token"))
        .filter(function (n) { return n.dataset.tok === id; })[0];
    }
    function drop(id, zid) {
      var node = nodeFor(id);
      var row = Array.prototype.slice.call(zoneBox.children).filter(function (r) { return r.dataset.zone === zid; })[0];
      if (!node || !row) return;
      if (node.parentNode === poolBox) poolBox.removeChild(node);
      row.querySelector(".wx-hold").appendChild(node);
      place[id] = zid;
      selected = null;
      paintSel();
      paint();
      ctx.onChange();
    }
    function paintSel() {
      Array.prototype.forEach.call(host.querySelectorAll(".wx-token"), function (n) {
        n.classList.toggle("wx-sel", n.dataset.tok === selected);
      });
    }
    function paint() {
      Array.prototype.forEach.call(host.querySelectorAll(".wx-token"), function (n) {
        var t = byId[n.dataset.tok];
        var inZone = n.closest(".wx-zone");
        n.classList.remove("wx-right", "wx-wrong");
        if (!inZone) {
          if (t && !t.zone) n.classList.add("wx-right");       // correctly left out
          return;
        }
        var ok = t && norm(t.zone) === norm(inZone.dataset.zone);
        n.classList.toggle("wx-right", !!ok);
        n.classList.toggle("wx-wrong", !ok);
      });
    }
    function revealMarks() {
      Array.prototype.forEach.call(zoneBox.children, function (row) {
        Array.prototype.forEach.call(row.querySelectorAll(".wx-token"), function (n) {
          var t = byId[n.dataset.tok];
          var ok = t && norm(t.zone) === norm(row.dataset.zone);
          n.classList.toggle("wx-right", !!ok);
          n.classList.toggle("wx-wrong", !ok);
        });
      });
    }
    return {
      getResp: function () { return { placements: place }; },
      reveal: function () {
        (item.tokens || []).forEach(function (t) { if (t.zone) drop(t.id, t.zone); });
        revealMarks();
      },
      clear: function () {
        place = {};
        selected = null;
        buildZones();
        buildPool();
      }
    };
  }


  /* ---------- drag / click blanks inside a code template ---------- */
  function renderBlanks(item, host, ctx) {
    var filled = {};                                       // blankId -> token text
    var selected = null;
    var tpl = el("pre", "wx-tpl");
    var poolBox = el("div", "wx-pool");
    var reusable = item.reusable !== false;
    var pool = (item.pool || []).slice();
    (item.blanks || []).forEach(function (b) {
      (b.options || []).forEach(function (o) {
        if (!pool.some(function (p) { return norm(p) === norm(o); })) pool.push(o);
      });
    });
    host.appendChild(el("p", "wx-hint",
      "Select a segment from the pool, then click the blank it belongs to (or drag it in). Click a filled blank to clear it."));

    (item.template || []).forEach(function (seg) {
      if (seg.blank != null) {
        var slot = el("button", "wx-blank", "\u25a1 " + seg.blank);
        slot.type = "button";
        slot.dataset.blank = seg.blank;
        (function (bid) {
          droppable(slot, function (txt) { put(bid, decodeURIComponent(txt || "")); });
          slot.addEventListener("click", function () {
            if (filled[bid] != null) { clearBlank(bid); return; }
            if (selected != null) put(bid, selected);
          });
        })(seg.blank);
        tpl.appendChild(slot);
      } else {
        tpl.appendChild(document.createTextNode(seg.text || ""));
      }
    });
    host.appendChild(tpl);
    host.appendChild(poolBox);

    seeded(ctx.seed, pool).forEach(function (t) {
      var b = el("button", "wx-token", t);
      b.type = "button";
      pickable(b, encodeURIComponent(t));
      b.addEventListener("click", function () {
        selected = (norm(b.textContent) === norm(selected)) ? null : b.textContent;
        paintSel();
      });
      poolBox.appendChild(b);
    });

    function poolNode(txt) {
      return Array.prototype.slice.call(poolBox.children).filter(function (c) { return c.textContent === txt; })[0];
    }
    function slotFor(bid) {
      return Array.prototype.slice.call(tpl.querySelectorAll(".wx-blank"))
        .filter(function (s) { return String(s.dataset.blank) === String(bid); })[0];
    }
    function put(bid, txt) {
      if (!txt) return;
      var blank = (item.blanks || []).filter(function (b) { return String(b.id) === String(bid); })[0];
      if (blank && blank.options && blank.options.length &&
          !blank.options.some(function (o) { return norm(o) === norm(txt); })) return;
      if (filled[bid] != null) clearBlank(bid, true);
      filled[bid] = txt;
      if (!reusable) { var n = poolNode(txt); if (n) n.disabled = true; }
      selected = null;
      paint();
      ctx.onChange();
    }
    function clearBlank(bid, silent) {
      var txt = filled[bid];
      delete filled[bid];
      if (!reusable && txt) { var n = poolNode(txt); if (n) n.disabled = false; }
      paint();
      if (!silent) ctx.onChange();
    }
    function paintSel() {
      Array.prototype.forEach.call(poolBox.children, function (n) {
        n.classList.toggle("wx-sel", norm(n.textContent) === norm(selected));
      });
    }
    function paint() {
      (item.blanks || []).forEach(function (b) {
        var slot = slotFor(b.id);
        if (!slot) return;
        var have = filled[b.id];
        slot.textContent = have == null ? ("\u25a1 " + b.id) : String(have);
        slot.classList.toggle("wx-filled", have != null);
        slot.classList.remove("wx-right", "wx-wrong");
      });
      paintSel();
    }
    function marks() {
      (item.blanks || []).forEach(function (b) {
        var slot = slotFor(b.id);
        if (!slot) return;
        var ok = norm(filled[b.id]) === norm(b.answer);
        slot.classList.toggle("wx-right", ok);
        slot.classList.toggle("wx-wrong", !ok);
      });
    }
    paint();
    return {
      getResp: function () { return { filled: filled }; },
      reveal: function () {
        (item.blanks || []).forEach(function (b) { filled[b.id] = b.answer; });
        paint();
        marks();
      },
      clear: function () {
        filled = {};
        selected = null;
        paint();
        Array.prototype.forEach.call(poolBox.children, function (n) { n.disabled = false; });
      }
    };
  }


  /* ---------- SVG hotspot (click one region) ---------- */
  var SVGNS = "http://www.w3.org/2000/svg";
  function renderGraphic(item, host, ctx) {
    var g = item.graphic || {}, chosen = [];
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", g.viewBox || "0 0 460 200");
    svg.setAttribute("class", "wx-svg");
    svg.setAttribute("role", "group");
    host.appendChild(svg);
    if (g.note) host.appendChild(el("p", "wx-hint", g.note));
    (g.regions || []).forEach(function (r) {
      var box = document.createElementNS(SVGNS, "rect");
      box.setAttribute("x", r.x); box.setAttribute("y", r.y);
      box.setAttribute("width", r.w); box.setAttribute("height", r.h);
      box.setAttribute("class", "wx-region");
      box.setAttribute("tabindex", "0");
      box.dataset.id = r.id;
      var label = document.createElementNS(SVGNS, "text");
      label.setAttribute("x", r.x + 6);
      label.setAttribute("y", r.y + 16);
      label.setAttribute("class", "wx-rlabel");
      label.textContent = r.label;
      function toggle() {
        var at = chosen.indexOf(r.id);
        if (at >= 0) chosen.splice(at, 1); else chosen.push(r.id);
        paint();
        ctx.onChange();
      }
      box.addEventListener("click", toggle);
      box.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
      });
      svg.appendChild(box);
      svg.appendChild(label);
    });
    function paint() {
      Array.prototype.forEach.call(svg.querySelectorAll(".wx-region"), function (n) {
        n.classList.toggle("wx-sel", chosen.indexOf(n.dataset.id) >= 0);
        n.classList.remove("wx-right", "wx-wrong");
      });
    }
    return {
      getResp: function () { return { answers: chosen }; },
      reveal: function () {
        chosen = (item.answer || []).slice();
        paint();
        Array.prototype.forEach.call(svg.querySelectorAll(".wx-region"), function (n) {
          var right = (item.answer || []).indexOf(n.dataset.id) >= 0;
          if (right) n.classList.add("wx-right");
          else if (n.classList.contains("wx-sel")) n.classList.add("wx-wrong");
        });
      },
      clear: function () { chosen = []; paint(); }
    };
  }

  /* ---------- one option list per labelled part of the exhibit ---------- */
  function renderGroups(item, host, ctx) {
    var wrap = el("div", "wx-groups"), selects = [];
    (item.groups || []).forEach(function (grp, gi) {
      var box = el("div", "wx-group");
      box.appendChild(el("div", "wx-group-label", grp.label));
      var sel = el("select", "wx-select");
      var blank = el("option", null, "- choose the segment -");
      blank.value = "";
      sel.appendChild(blank);
      seeded(ctx.seed + ":" + gi, grp.options || []).forEach(function (o) {
        var op = el("option", null, o);
        op.value = o;
        sel.appendChild(op);
      });
      sel.addEventListener("change", function () { ctx.onChange(); marks(); });
      box.appendChild(sel);
      selects.push(sel);
      wrap.appendChild(box);
    });
    host.appendChild(wrap);
    function marks() {
      (item.answer || []).forEach(function (w, i) {
        var sel = selects[i];
        if (!sel) return;
        var ok = norm(sel.value) === norm(w);
        sel.classList.toggle("wx-right", ok);
        sel.classList.toggle("wx-wrong", sel.value !== "" && !ok);
      });
    }
    return {
      getResp: function () { return { picks: selects.map(function (s) { return s.value; }) }; },
      reveal: function () {
        (item.answer || []).forEach(function (w, i) { if (selects[i]) selects[i].value = w; });
        marks();
      },
      clear: function () { selects.forEach(function (s) { s.value = ""; }); marks(); }
    };
  }

  /* ---------- typed fill-in blanks ---------- */
  function renderFillBlank(item, host, ctx) {
    var tpl = el("pre", "wx-tpl"), inputs = {};
    (item.template || []).forEach(function (seg) {
      if (seg.blank != null) {
        var inp = el("input", "wx-input");
        inp.type = "text";
        inp.size = 14;
        inp.dataset.blank = seg.blank;
        inp.addEventListener("input", function () { ctx.onChange(); });
        inputs[seg.blank] = inp;
        tpl.appendChild(inp);
      } else {
        tpl.appendChild(document.createTextNode(seg.text || ""));
      }
    });
    host.appendChild(tpl);
    return {
      getResp: function () {
        var out = {};
        Object.keys(inputs).forEach(function (k) { out[k] = inputs[k].value; });
        return { texts: out };
      },
      reveal: function () {
        (item.blanks || []).forEach(function (b) {
          var inp = inputs[b.id];
          if (!inp) return;
          inp.value = b.answer;
          inp.classList.add("wx-right");
        });
      },
      clear: function () {
        Object.keys(inputs).forEach(function (k) {
          inputs[k].value = "";
          inputs[k].classList.remove("wx-right", "wx-wrong");
        });
      }
    };
  }

  /* ---------- study-only item (image answer area in the source PDF) ---------- */
  function renderText(item, host) {
    host.appendChild(el("p", "wx-hint", item.unavailable
      ? "The source PDF stores this answer area as a picture, so it cannot be answered interactively. " +
        "Open Study Mode to read the published solution, then reproduce it in the workspace."
      : "Read the statements above, decide your answer, then check it in Study Mode."));
    return { getResp: function () { return {}; }, reveal: function () {}, clear: function () {} };
  }

  /* ---------- dispatcher ---------- */
  Widgets.render = function (task, host, hooks) {
    hooks = hooks || {};
    var item = (task && task.item) || { type: "text" };
    var ctx = {
      seed: String((task && (task.ref || task.taskId)) || "x") + "|" + String((task && task.instruction) || "").slice(0, 40),
      onChange: function () { if (hooks.onChange) hooks.onChange(); }
    };
    host.innerHTML = "";
    host.className = "wx wx-" + item.type;
    badgeInto(item, host);
    promptInto(item, host);
    var api;
    if (item.type === "choice" || item.type === "multi") api = renderChoice(item, host, ctx);
    else if (item.type === "yesno") api = renderYesNo(item, host, ctx);
    else if (item.type === "sequence") api = renderSequence(item, host, ctx);
    else if (item.type === "match") api = renderMatch(item, host, ctx);
    else if (item.type === "groupchoice") api = renderGroups(item, host, ctx);
    else if (item.type === "fillblank") api = renderFillBlank(item, host, ctx);
    else if (item.type === "hotarea" && item.graphic) api = renderGraphic(item, host, ctx);
    else if ((item.type === "hotarea" || item.type === "dropblank") && !item.blanks && item.options) api = renderChoice(item, host, ctx);
    else if (item.type === "dropblank" || item.type === "hotarea") api = renderBlanks(item, host, ctx);
    else api = renderText(item, host);
    return {
      type: item.type,
      interactive: item.type !== "text",
      getResp: api.getResp,
      reveal: api.reveal,
      reset: api.clear
    };
  };

  Widgets.util = { el: el, code: code, norm: norm, seeded: seeded, eqList: eqList };
  global.Widgets = Widgets;
  if (typeof module !== "undefined" && module.exports) module.exports = Widgets;
})(typeof window !== "undefined" ? window : this);

