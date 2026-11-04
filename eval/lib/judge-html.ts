import { xLength } from "../../src/modules/capture/drafting/draft-core";
import { Letter, LETTERS } from "./arms";

// judge.html: the blind sheet. One self-contained file (inline CSS and JS,
// no network), readable on a phone, that works offline.
//
// BLINDING: JudgeSheet has no field that can carry an arm name, model,
// prompt or the shuffle seed, so the renderer can't be handed one. On top
// of that, generate.ts runs findLeaks() on the finished file and refuses to
// write it if anything slips in (judge-html.spec.ts pins both).

export interface JudgeSheet {
  // Random per run and unrelated to the seed: lets the scorer check the
  // results came from this sheet.
  sheetId: string;
  judge: string;
  updates: Array<{
    id: string;
    formatLabel: string;
    isX: boolean;
    raw: string;
    drafts: Record<Letter, string>;
  }>;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
:root { --bg:#f6f5fb; --card:#ffffff; --ink:#1d1b2e; --muted:#5f5b78; --faint:#8a86a3; --line:#e3e0f0; --accent:#5b4fe9; --accent-ink:#ffffff; --soft:#eeecfb; }
@media (prefers-color-scheme: dark) { :root { --bg:#14121f; --card:#1d1a2c; --ink:#eeecf8; --muted:#b4b0cc; --faint:#8783a3; --line:#2f2b45; --accent:#8579ff; --accent-ink:#14121f; --soft:#26223a; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width:720px; margin:0 auto; padding:24px 16px 160px; }
h1 { font-size:24px; line-height:1.2; margin:0 0 8px; }
.intro { color:var(--muted); margin:0 0 24px; font-size:15px; }
.update { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px; margin:0 0 20px; }
.update-head { display:flex; justify-content:space-between; gap:12px; font-size:13px; color:var(--faint); margin-bottom:10px; text-transform:uppercase; letter-spacing:.06em; }
.raw { background:var(--soft); border-radius:12px; padding:12px 14px; margin-bottom:16px; }
.label { font-size:12px; font-weight:600; color:var(--muted); margin-bottom:4px; }
.text { white-space:pre-wrap; overflow-wrap:anywhere; margin:0; }
.draft { border:1px solid var(--line); border-radius:14px; padding:14px; margin-bottom:12px; }
.draft-head { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px; }
.letter { font-weight:700; font-size:18px; }
.count { font-size:12px; color:var(--faint); }
fieldset { border:0; padding:0; margin:12px 0 0; }
legend { font-size:14px; font-weight:600; padding:0; margin-bottom:6px; }
.choices { display:flex; flex-wrap:wrap; gap:8px; }
.choices label { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); border-radius:999px; padding:8px 14px; min-height:44px; cursor:pointer; }
.choices input { width:18px; height:18px; accent-color:var(--accent); margin:0; }
textarea { width:100%; min-height:72px; border:1px solid var(--line); border-radius:12px; padding:10px 12px; background:transparent; color:var(--ink); font:inherit; font-size:15px; }
.comment { display:block; margin-top:14px; font-size:14px; font-weight:600; }
.bar { position:fixed; left:0; right:0; bottom:0; background:var(--card); border-top:1px solid var(--line); padding:12px 16px calc(12px + env(safe-area-inset-bottom)); }
.bar-inner { max-width:720px; margin:0 auto; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; }
#progress { font-size:14px; color:var(--muted); }
button { background:var(--accent); color:var(--accent-ink); border:0; border-radius:999px; padding:12px 20px; font:inherit; font-weight:700; min-height:44px; cursor:pointer; }
#status { width:100%; font-size:13px; color:var(--muted); margin:0; }
#output { display:none; width:100%; min-height:120px; font-family:ui-monospace, Menlo, Consolas, monospace; font-size:12px; }
`;

// Reads the form, saves progress on this device, and copies a JSON blob to
// paste back. Uses only the DOM: ids and letters come from data attributes.
const SCRIPT = `
(function () {
  var sheet = document.body.getAttribute("data-sheet");
  var judge = document.body.getAttribute("data-judge");
  var storeName = "taste-test:" + sheet;
  var sections = Array.prototype.slice.call(document.querySelectorAll("section.update"));
  var letters = ["A", "B", "C"];

  function picked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function collect() {
    var missing = [];
    var answers = sections.map(function (section, i) {
      var id = section.getAttribute("data-id");
      var favorite = picked("fav-" + id);
      if (!favorite) missing.push("update " + (i + 1) + ": favorite");
      var postAsIs = {};
      letters.forEach(function (l) {
        var v = picked("asis-" + id + "-" + l);
        if (v === null) missing.push("update " + (i + 1) + ": post " + l + " as-is?");
        postAsIs[l] = v === null ? null : v === "yes";
      });
      var comment = section.querySelector("textarea").value.trim();
      return { id: id, favorite: favorite, postAsIs: postAsIs, comment: comment };
    });
    return { result: { sheet: sheet, judge: judge, answers: answers }, missing: missing };
  }

  function save() {
    var state = {};
    Array.prototype.forEach.call(document.querySelectorAll("input:checked"), function (el) { state[el.name] = el.value; });
    Array.prototype.forEach.call(document.querySelectorAll("textarea[name]"), function (el) { state[el.name] = el.value; });
    try { localStorage.setItem(storeName, JSON.stringify(state)); } catch (e) {}
  }

  function restore() {
    var state = null;
    try { state = JSON.parse(localStorage.getItem(storeName) || "null"); } catch (e) {}
    if (!state) return;
    Object.keys(state).forEach(function (name) {
      var radio = document.querySelector('input[name="' + name + '"][value="' + state[name] + '"]');
      if (radio) { radio.checked = true; return; }
      var area = document.querySelector('textarea[name="' + name + '"]');
      if (area) area.value = state[name];
    });
  }

  function progress() {
    var done = sections.filter(function (section) {
      var id = section.getAttribute("data-id");
      return picked("fav-" + id) && letters.every(function (l) { return picked("asis-" + id + "-" + l) !== null; });
    }).length;
    document.getElementById("progress").textContent = done + " of " + sections.length + " done";
  }

  function showForManualCopy(text, message) {
    var out = document.getElementById("output");
    out.value = text;
    out.style.display = "block";
    out.focus();
    out.select();
    document.getElementById("status").textContent = message;
  }

  document.getElementById("copy").addEventListener("click", function () {
    var c = collect();
    if (c.missing.length > 0) {
      document.getElementById("status").textContent = "Still to answer: " + c.missing.join("; ") + ".";
      return;
    }
    var text = JSON.stringify(c.result, null, 2);
    var done = function () { document.getElementById("status").textContent = "Copied. Paste it back in the chat."; };
    var manual = function () { showForManualCopy(text, "Couldn't copy automatically: select all of the text below and copy it."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, manual);
    } else {
      manual();
    }
  });

  document.addEventListener("change", function () { save(); progress(); });
  document.addEventListener("input", save);
  restore();
  progress();
})();
`;

function radioGroup(name: string, options: Array<{ value: string; label: string }>): string {
  return `<div class="choices">${options
    .map((o) => `<label><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}</label>`)
    .join("")}</div>`;
}

export function renderJudgeHtml(sheet: JudgeSheet): string {
  const total = sheet.updates.length;
  const sections = sheet.updates
    .map((u, i) => {
      const drafts = LETTERS.map((letter) => {
        const body = u.drafts[letter];
        const count = u.isX ? `<span class="count">${xLength(body)} characters</span>` : "";
        return `<div class="draft"><div class="draft-head"><span class="letter">${letter}</span>${count}</div>
<p class="text">${escapeHtml(body)}</p>
<fieldset><legend>Would you post ${letter} as-is?</legend>${radioGroup(`asis-${u.id}-${letter}`, [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ])}</fieldset></div>`;
      }).join("\n");
      return `<section class="update" data-id="${escapeHtml(u.id)}">
<div class="update-head"><span>Update ${i + 1} of ${total}</span><span>${escapeHtml(u.formatLabel)}</span></div>
<div class="raw"><div class="label">The update</div><p class="text">${escapeHtml(u.raw)}</p></div>
${drafts}
<fieldset><legend>Your favorite</legend>${radioGroup(`fav-${u.id}`, LETTERS.map((l) => ({ value: l, label: l })))}</fieldset>
<label class="comment">Comment (optional)<textarea name="comment-${escapeHtml(u.id)}" placeholder="Anything that made one stand out?"></textarea></label>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft taste test</title><style>${STYLE}</style></head>
<body data-sheet="${escapeHtml(sheet.sheetId)}" data-judge="${escapeHtml(sheet.judge)}"><main>
<h1>Draft taste test</h1>
<p class="intro">Hi ${escapeHtml(sheet.judge)}. Each update below has three drafts, A, B and C, in a random order. For each one, say whether you'd post it as-is, then pick your favorite. Your answers are saved on this device as you go. When you're done, tap “Copy results” and paste it back in the chat.</p>
${sections}
</main>
<div class="bar"><div class="bar-inner"><span id="progress"></span><button id="copy" type="button">Copy results</button><p id="status" aria-live="polite"></p><textarea id="output" readonly aria-label="Results"></textarea></div></div>
<script>${SCRIPT}</script>
</body></html>
`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// What must never appear in judge.html outside the judged text itself.
// Content (the update, the drafts, the judge's name, update ids) is removed
// first, because a draft may well say "founder" or "Misuq"; everything left
// is our template, and none of these may be in it.
export function findLeaks(html: string, opts: { content: string[]; forbidden: string[] }): string[] {
  let template = html;
  const pieces = [...new Set(opts.content.filter((c) => c.length > 0).map(escapeHtml))].sort((a, b) => b.length - a.length);
  for (const piece of pieces) template = template.split(piece).join("");

  const found: string[] = [];
  for (const token of opts.forbidden) {
    if (!token) continue;
    const pattern = /^\w/.test(token) && /\w$/.test(token) ? `\\b${escapeRegex(token)}\\b` : escapeRegex(token);
    if (new RegExp(pattern, "i").test(template)) found.push(token);
  }
  // Self-contained: nothing loaded from anywhere.
  for (const ref of [/\bsrc\s*=/i, /href\s*=\s*["']?\s*(https?:)?\/\//i, /url\(/i, /@import/i, /<link\b/i, /\bfetch\(/i, /XMLHttpRequest/i]) {
    if (ref.test(template)) found.push(`external reference ${ref}`);
  }
  return found;
}
