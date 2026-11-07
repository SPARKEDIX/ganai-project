/* BrandRadar — client-side LLM visibility checker (no backend, keys stay in the browser) */
"use strict";

/* ---------------- Providers ---------------- */
const PROVIDERS = [
  {
    id: "openai", label: "OpenAI", icon: "🐙", color: "#10a37f",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
    api: async (key, prompt, model) => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model, temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || "OpenAI error " + r.status);
      return d.choices?.[0]?.message?.content || "";
    }
  },
  {
    id: "gemini", label: "Gemini", icon: "✨", color: "#4285F4",
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
    api: async (key, prompt, model) => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
          })
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || "Gemini error " + r.status);
      return d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
  },
  {
    id: "groq", label: "Groq", icon: "⚡", color: "#f55036",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    api: async (key, prompt, model) => {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model, temperature: 0.3,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || "Groq error " + r.status);
      return d.choices?.[0]?.message?.content || "";
    }
  }
];

/* ---------------- Helpers ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const getKey = (id) => localStorage.getItem("br_key_" + id) || "";
const setKey = (id, v) => localStorage.setItem("br_key_" + id, v.trim());
const getModel = (id) => localStorage.getItem("br_model_" + id) || "";
const setModel = (id, v) => localStorage.setItem("br_model_" + id, v);

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  t.style.borderColor = isErr ? "var(--red)" : "var(--border)";
  setTimeout(() => t.classList.add("hidden"), 3500);
}

function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
  }
  return null;
}

function buildPrompt(brand) {
  return `You are a brand visibility analyst. A user wants to know how visible their brand "${brand}" is to AI assistants and the internet at large.
Reply with ONLY valid JSON (no markdown, no commentary):
{"mentioned": true, "sentiment": "positive|neutral|negative", "summary": "...", "tips": ["tip1", "tip2", "tip3"]}
Rules:
- mentioned=true ONLY if the brand is a recognizable, real entity.
- sentiment = how the AI perceives the brand.
- summary = 2-3 sentences explaining what the AI knows or associates with the brand.
- tips = exactly 3 actionable ways to get mentioned more by AI (SEO, citations, content, etc.).`;
}

function scoreFor(res) {
  if (!res) return 0;
  let s = res.mentioned ? 60 : 10;
  if (res.sentiment === "positive") s += 30;
  else if (res.sentiment === "neutral") s += 15;
  else if (res.sentiment === "negative") s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function sentimentClass(s) {
  if (s === "positive") return "pos";
  if (s === "negative") return "neg";
  return "neu";
}

/* ---------------- Keys UI ---------------- */
function renderKeys() {
  const grid = $("#keysGrid");
  grid.innerHTML = "";
  for (const p of PROVIDERS) {
    const key = getKey(p.id);
    const model = getModel(p.id) || p.models[0];
    const box = document.createElement("div");
    box.className = "key-box";
    box.innerHTML = `
      <div class="k-head"><span class="k-icon">${p.icon}</span>${p.label}</div>
      <input type="password" data-key="${p.id}" placeholder="API key…" value="${esc(key)}" autocomplete="off" />
      <select data-model="${p.id}">${p.models.map((m) => `<option value="${m}" ${m === model ? "selected" : ""}>${m}</option>`).join("")}</select>
      <div class="k-status ${key ? "ok" : "missing"}">${key ? "✓ Key set (browser mein)" : "✗ Key nahi hai"}</div>`;
    grid.appendChild(box);
  }
}

$("#keysGrid").addEventListener("input", (e) => {
  const el = e.target;
  if (el.matches("[data-key]")) {
    setKey(el.dataset.key, el.value);
    el.parentElement.querySelector(".k-status").className =
      "k-status " + (el.value.trim() ? "ok" : "missing");
    el.parentElement.querySelector(".k-status").textContent = el.value.trim() ? "✓ Key set (browser mein)" : "✗ Key nahi hai";
  } else if (el.matches("[data-model]")) {
    setModel(el.dataset.model, el.value);
  }
});

/* ---------------- Scan logic ---------------- */
function activeProviders() {
  return PROVIDERS.filter((p) => getKey(p.id));
}

async function scanBrand(brand) {
  const providers = activeProviders();
  if (!providers.length) throw new Error("Pehle kam se kam ek LLM API key daalo (upar)");

  const tasks = providers.map(async (p) => {
    const start = Date.now();
    try {
      const text = await p.api(getKey(p.id), buildPrompt(brand), getModel(p.id) || p.models[0]);
      const res = parseJSON(text);
      if (!res) throw new Error("AI response valid JSON nahi tha");
      return { provider: p, res, score: scoreFor(res), ms: Date.now() - start, error: null };
    } catch (err) {
      return { provider: p, res: null, score: 0, ms: Date.now() - start, error: err.message };
    }
  });

  return Promise.all(tasks);
}

/* ---------------- Render results ---------------- */
function renderReport(brand, items) {
  $("#resultBrand").textContent = brand;

  const ok = items.filter((i) => !i.error && i.res);
  const errors = items.filter((i) => i.error);

  // Aggregate
  const scores = ok.map((i) => i.score);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const sentiments = ok.map((i) => i.res.sentiment);
  const sentiment = sentiments.includes("positive") ? "positive" : sentiments.includes("negative") ? "negative" : sentiments.length ? "neutral" : "unknown";
  const mentionedAny = ok.some((i) => i.res.mentioned);
  const summary = (ok.find((i) => i.res.mentioned) || ok[0])?.res.summary || "AI ko ye brand nahi mila — abhi tak zyada visible nahi hai.";
  const tips = [...new Set(ok.flatMap((i) => i.res.tips || []))].slice(0, 5);

  // Gauge
  const circ = 2 * Math.PI * 50;
  $("#gaugeFg").style.strokeDasharray = circ;
  $("#gaugeFg").style.strokeDashoffset = circ;
  $("#scoreVal").textContent = avg;
  requestAnimationFrame(() => {
    $("#gaugeFg").style.strokeDashoffset = circ * (1 - avg / 100);
  });
  const hue = avg >= 70 ? "34,197,94" : avg >= 40 ? "245,158,11" : "239,68,68";
  $("#gaugeFg").style.stroke = `rgb(${hue})`;

  // Badges
  const sb = $("#sentimentBadge");
  sb.textContent = sentiment === "positive" ? "😀 Positive" : sentiment === "negative" ? "😠 Negative" : "😐 Neutral";
  sb.className = "badge " + sentimentClass(sentiment);
  const mb = $("#mentionBadge");
  mb.textContent = mentionedAny ? "✅ AI jaanta hai" : "❌ AI ko nahi jaanta";
  mb.className = "badge dim";
  $("#summaryText").textContent = summary;

  // Provider cards
  const pr = $("#providerResults");
  pr.innerHTML = "";
  for (const item of items) {
    const p = item.provider;
    const card = document.createElement("div");
    card.className = "p-card";
    if (item.error) {
      card.innerHTML = `
        <div class="p-head"><span class="p-name">${p.icon} ${p.label}</span></div>
        <div class="p-msg">⚠ ${esc(item.error)}</div>`;
    } else {
      card.innerHTML = `
        <div class="p-head">
          <span class="p-name">${p.icon} ${p.label}</span>
          <span class="p-score" style="color:${p.color}">${item.score}<small style="color:var(--dim)">/100</small></span>
        </div>
        <div class="p-sent">${item.res.mentioned ? "Mentioned" : "Not mentioned"} · ${item.res.sentiment}</div>
        <div class="p-msg">${esc(item.res.summary)}</div>`;
    }
    pr.appendChild(card);
  }

  // Tips
  const tl = $("#tipsList");
  tl.innerHTML = "";
  if (tips.length) {
    for (const t of tips) {
      const li = document.createElement("li");
      li.textContent = t;
      tl.appendChild(li);
    }
  } else {
    tl.innerHTML = "<li>Pehle kisi provider ki key add karo, phir scan karo.</li>";
  }

  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });

  saveHistory(brand, avg, items);
  renderHistory();
}

/* ---------------- History ---------------- */
function getHistory() {
  try { return JSON.parse(localStorage.getItem("br_history") || "[]"); } catch (_) { return []; }
}
function saveHistory(brand, avg, items) {
  const h = getHistory();
  h.unshift({
    brand, avg, when: new Date().toISOString(),
    by: Object.fromEntries(items.map((i) => [i.provider.id, i.error ? null : i.score]))
  });
  localStorage.setItem("br_history", JSON.stringify(h.slice(0, 20)));
}
function renderHistory() {
  const h = getHistory();
  const body = $("#historyBody");
  const empty = $("#historyEmpty");
  body.innerHTML = "";
  if (!h.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  for (const e of h) {
    const tr = document.createElement("tr");
    const when = new Date(e.when).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    tr.innerHTML = `
      <td><b>${esc(e.brand)}</b></td>
      <td>${e.avg}/100</td>
      <td>${when}</td>
      <td><button class="load-btn" data-brand="${esc(e.brand)}">↺ Load</button></td>`;
    body.appendChild(tr);
  }
}

$("#historyBody").addEventListener("click", (e) => {
  const btn = e.target.closest(".load-btn");
  if (!btn) return;
  $("#brandInput").value = btn.dataset.brand;
  $("#scanBtn").click();
});

/* ---------------- Scan button ---------------- */
$("#scanBtn").addEventListener("click", async () => {
  const brand = $("#brandInput").value.trim();
  if (!brand) { toast("Pehle brand ka naam likho ✍️"); return; }

  const btn = $("#scanBtn");
  const status = $("#statusBar");
  btn.disabled = true; btn.classList.add("loading");
  status.classList.remove("hidden"); status.classList.remove("error");
  status.textContent = `⏳ "${brand}" ka AI scan chal raha hai…`;

  try {
    const items = await scanBrand(brand);
    status.classList.add("hidden");
    renderReport(brand, items);
  } catch (err) {
    status.classList.add("error");
    status.textContent = "⚠ " + err.message;
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
  }
});

$("#brandInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#scanBtn").click();
});

/* ---------------- Competitor compare ---------------- */
let competitors = [];
function renderChips() {
  const wrap = $("#compChips");
  wrap.innerHTML = "";
  for (const c of competitors) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${esc(c)} <button data-remove="${esc(c)}">✕</button>`;
    wrap.appendChild(chip);
  }
  $("#compareBtn").disabled = competitors.length === 0 || activeProviders().length === 0;
}
$("#compAdd").addEventListener("click", () => {
  const v = $("#compInput").value.trim();
  if (!v) return;
  if (!competitors.includes(v.toLowerCase())) competitors.push(v);
  $("#compInput").value = "";
  renderChips();
});
$("#compInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#compAdd").click(); });
$("#compChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove]");
  if (!b) return;
  competitors = competitors.filter((c) => c.toLowerCase() !== b.dataset.remove.toLowerCase());
  renderChips();
});

$("#compareBtn").addEventListener("click", async () => {
  const btn = $("#compareBtn");
  const bars = $("#compareBars");
  btn.disabled = true; btn.textContent = "Comparing…";
  bars.innerHTML = '<p class="small-note">⏳ Compare ho raha hai…</p>';

  const all = [document.getElementById("brandInput").value.trim(), ...competitors].filter(Boolean);
  const results = [];
  for (const b of all) {
    try {
      const items = await scanBrand(b);
      const ok = items.filter((i) => !i.error && i.res);
      const avg = ok.length ? Math.round(ok.reduce((s, i) => s + i.score, 0) / ok.length) : 0;
      results.push({ name: b, score: avg });
    } catch (err) {
      results.push({ name: b, score: 0, error: err.message });
    }
  }

  bars.innerHTML = "";
  const max = Math.max(1, ...results.map((r) => r.score));
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "cbar-row";
    row.innerHTML = `
      <div class="cbar-label"><span>${esc(r.name)}</span><span><b>${r.score}</b>/100</span></div>
      <div class="cbar-track"><div class="cbar-fill" data-w="${r.score / max * 100}"></div></div>
      ${r.error ? `<div class="small-note">⚠ ${esc(r.error)}</div>` : ""}`;
    bars.appendChild(row);
  }
  requestAnimationFrame(() => {
    bars.querySelectorAll(".cbar-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; });
  });

  btn.disabled = false; btn.textContent = "Compare karo 🥊";
  bars.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

/* ---------------- Init ---------------- */
renderKeys();
renderHistory();
