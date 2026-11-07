"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const C = { GOOD: "good", WARN: "warn", BAD: "bad" };

function clampScore(s) { return Math.max(0, Math.min(100, Math.round(s || 0))); }
function verdict(score) {
  if (score >= 65) return { label: "Strong visibility", tone: C.GOOD, mark: "●" };
  if (score >= 35) return { label: "Building presence", tone: C.WARN, mark: "◐" };
  return { label: "Invisible to AI", tone: C.BAD, mark: "○" };
}
function toneFor(s) {
  if (s === "positive") return { label: "Positive", tone: C.GOOD };
  if (s === "negative") return { label: "Negative", tone: C.BAD };
  return { label: "Neutral", tone: C.WARN };
}

/* ——— Voice engine (browser-independent: recording → backend Whisper) ——— */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(new Error("FileReader failed"));
    fr.readAsDataURL(blob);
  });
}

async function recordOnce(maxMs = 8000) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error("NO_MIC_API");
    throw e;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const e = new Error(
      err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
        ? "PERMISSION"
        : err.name === "NotFoundError" || err.name === "DevicesNotFoundError"
        ? "NO_DEVICE"
        : "NO_MIC_API"
    );
    throw e;
  }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start();
  await new Promise((r) => setTimeout(r, maxMs));
  if (rec.state !== "inactive") rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: mime.split(";")[0] });
}

async function transcribe(blob) {
  const b64 = await blobToBase64(blob);
  const res = await fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: b64, mime: blob.type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "STT failed");
  return data.text;
}

function micErrorText(err) {
  if (err?.message === "PERMISSION") {
    return "Mic permission deny hai — browser ke address bar (lock icon) se allow karo, phir try karo.";
  }
  if (err?.message === "NO_DEVICE") {
    return "Koi microphone device nahi mila — mic connect karke try karo.";
  }
  if (err?.message === "NO_MIC_API") {
    return "Is browser mein mic recording available nahi hai — Chrome/Edge use karo (HTTPS par).";
  }
  return err?.message || "Mic error";
}

export default function Home() {
  const [brand, setBrand] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const [report, setReport] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [compare, setCompare] = useState([]);
  const [comparing, setComparing] = useState(false);
  const [history, setHistory] = useState([]);

  // voice (input mic)
  const [recording, setRecording] = useState(false);
  const recBusy = useRef(false);

  // crystal ball
  const [ballOpen, setBallOpen] = useState(false);
  const [ballState, setBallState] = useState("idle"); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState([]);
  const ballBusy = useRef(false);
  const ballStopRef = useRef(null);

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("br_history") || "[]")); } catch { setHistory([]); }
  }, []);

  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  const pushHistory = useCallback((entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.brand !== entry.brand)].slice(0, 6);
      try { localStorage.setItem("br_history", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const analyze = useCallback(async (brands, { silent = false } = {}) => {
    if (!brands.length) return null;
    if (!silent) setLoading(true);
    setStatus("analyzing");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brands }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      return data.results;
    } catch (e) {
      setStatus("error:" + e.message);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const runScan = useCallback(async () => {
    const b = brand.trim();
    if (!b) { setStatus("error:Pehle brand ka naam likho."); return; }
    const results = await analyze([b]);
    if (!results) return;
    const r = results[0];
    if (!r.ok) { setStatus("error:" + (r.error || "Analysis failed")); return; }
    setReport({ brand: b, result: r });
    setStatus("");
    pushHistory({ brand: b, score: r.score, when: Date.now() });
  }, [brand, analyze, pushHistory]);

  const runCompare = useCallback(async () => {
    const all = [brand.trim(), ...competitors].filter(Boolean);
    if (all.length < 2) { setStatus("error:Compare karne ke liye kam se kam 2 brands do."); return; }
    setComparing(true);
    setCompare([]);
    setStatus("");
    const results = await analyze(all, { silent: true });
    setComparing(false);
    if (!results) { setStatus("error:Compare fail ho gaya."); return; }
    setCompare(results);
  }, [brand, competitors, analyze]);

  /* ——— mic input (main bar) ——— */
  const runMicInput = useCallback(async () => {
    if (recBusy.current) return;
    recBusy.current = true;
    setRecording(true);
    setStatus("listening");
    try {
      const blob = await recordOnce();
      setStatus("transcribing");
      const text = await transcribe(blob);
      if (text) { setBrand(text); setStatus(""); }
      else setStatus("error:Awaaz samajh nahi aayi.");
    } catch (e) {
      setStatus("error:" + micErrorText(e));
    } finally {
      setRecording(false);
      recBusy.current = false;
    }
  }, []);

  /* ——— Crystal Ball: voice-to-voice ——— */
  const speak = useCallback((text, onEnd) => {
    if (!("speechSynthesis" in window)) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    u.rate = 1;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
  }, []);

  const ballListen = useCallback(async () => {
    if (ballBusy.current) return;
    ballBusy.current = true;
    setBallState("listening");
    try {
      const blob = await recordOnce(7000);
      setBallState("thinking");
      const userText = await transcribe(blob);
      if (!userText) {
        setTranscript((p) => [...p, { who: "oracle", text: "Mujhe aapki awaaz samajh nahi aayi — thoda clear boliye." }]);
        setBallState("speaking");
        speak("Mujhe aapki awaaz samajh nahi aayi. Thoda clear boliye.", () => { setBallState("idle"); });
        return;
      }
      setTranscript((p) => [...p, { who: "user", text: userText }]);

      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Oracle failed");
      const reply = data.reply;

      setTranscript((p) => [...p, { who: "oracle", text: reply }]);
      setBallState("speaking");
      speak(reply, () => {
        setBallState("idle");
        // auto re-listen — continuous conversation, jab tak ball band na ho
        if (ballStopRef.current === "go") ballListen();
        else ballStopRef.current = null;
      });
    } catch (e) {
      setBallState("idle");
      setTranscript((p) => [...p, { who: "oracle", text: "⚠ " + micErrorText(e) }]);
    } finally {
      ballBusy.current = false;
    }
  }, [speak]);

  const openBall = useCallback(() => {
    setBallOpen(true);
    setTranscript([]);
    setBallState("idle");
    ballStopRef.current = "go";
    setTimeout(() => { if (ballStopRef.current === "go") ballListen(); }, 600);
  }, [ballListen]);

  const closeBall = useCallback(() => {
    ballStopRef.current = "stop";
    setBallOpen(false);
    setBallState("idle");
    try { window.speechSynthesis?.cancel(); } catch {}
  }, []);

  const toggleBallTalk = useCallback(() => {
    if (ballState === "speaking") {
      try { window.speechSynthesis?.cancel(); } catch {}
      setBallState("idle");
    } else if (ballState === "idle") {
      ballListen();
    }
  }, [ballState, ballListen]);

  /* ——— compare helpers ——— */
  const addCompetitor = () => {
    const v = brand.trim();
    if (!v) { setStatus("error:Pehle main brand naam likho."); return; }
    setCompetitors((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };
  const removeCompetitor = (v) => setCompetitors((prev) => prev.filter((x) => x !== v));

  const v = report ? verdict(report.result.score) : null;
  const circ = 2 * Math.PI * 70;

  return (
    <>
      <div className="canvas" aria-hidden="true" />

      {/* nav — N5 floating pill */}
      <header className="nav">
        <div className="logo">
          <span className="logo-dot" aria-hidden="true" />
          BrandRadar <small>· AI visibility</small>
        </div>
        <nav className="nav-links">
          <a href="#scan">Scan</a>
          <a href="#compare">Compare</a>
          <a href="#history">History</a>
          <a className="gh" href="https://github.com/SPARKEDIX/ganai-project" target="_blank" rel="noopener noreferrer">
            Source ↗
          </a>
        </nav>
      </header>

      <main className="wrap">
        {/* hero */}
        <section className="hero">
          <span className="eyebrow">⌁ AI Visibility Checker</span>
          <h1>
            What does AI say about <span className="hl">your brand</span>?
          </h1>
          <p className="sub">
            Type a brand name — yours, a competitor’s, anything — and we ask a
            real LLM what it knows. You get a <b>visibility score</b>,{" "}
            <b>sentiment</b>, and <b>fixes</b>. No signup, no chat, no cost.
          </p>
          <div style={{ marginTop: "28px", display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn" onClick={openBall}>
              🔮 Voice-to-Voice
            </button>
            <button className="btn ghost" onClick={() => speak("Welcome to Brand Radar. Type a brand name and press scan, or tap the microphone to speak it.")}>
              🔊 Demo intro
            </button>
          </div>
        </section>

        {/* console */}
        <section className="console" id="scan">
          <div className="console-bar">
            <span className="pips" aria-hidden="true"><span /><span /><span /></span>
            <span>~/brandradar — scan &gt; analyze &gt; verdict</span>
          </div>

          <div className="scan-row">
            <div className="scan-input-wrap">
              <input
                className="scan-input"
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runScan(); }}
                placeholder="e.g. Tesla, Zomato, ya tera apna brand…"
                aria-label="Brand name"
                disabled={loading}
              />
              <button
                className={"mic-btn" + (recording ? " listening" : "")}
                onClick={runMicInput}
                disabled={recording}
                aria-label={recording ? "Recording…" : "Speak the brand name"}
                title="Voice input (bolo)"
              >
                {recording ? "■" : "🎙"}
              </button>
            </div>
            <button className="btn" onClick={runScan} disabled={loading || !!report}>
              {loading ? "Scanning…" : "Scan now"}
            </button>
          </div>

          <div className={"status-line" + (status.startsWith("error:") ? " error" : "")} aria-live="polite">
            {status ? (status === "listening" ? "🎙 Sun raha hoon… bolo" : status === "transcribing" ? "✍️ Awaaz likh raha hoon…" : status === "analyzing" ? "⏳ AI soch raha hai…" : status.replace(/^error:/, "⚠ ")) : "\u00A0"}
          </div>
        </section>

        {/* report */}
        {report && v && (
          <section className="card fade-in" aria-live="polite">
            <h2>
              Report <span className="dim">· {report.brand}</span>
            </h2>

            <div className="report-grid">
              <div className="gauge-wrap">
                <svg viewBox="0 0 160 160" className="gauge" width="170" height="170">
                  <circle className="gauge-track" cx="80" cy="80" r="70" />
                  <circle
                    className="gauge-fill"
                    cx="80" cy="80" r="70"
                    style={{
                      strokeDasharray: circ,
                      strokeDashoffset: circ * (1 - report.result.score / 100),
                      stroke: v.tone === C.GOOD ? "var(--color-good)" : v.tone === C.WARN ? "var(--color-warn)" : "var(--color-bad)",
                    }}
                  />
                </svg>
                <div className="gauge-center">
                  <span className="num">{report.result.score}</span>
                  <span className="lbl">/ 100</span>
                </div>
              </div>

              <div>
                <div className="verdict">
                  <span className={"badge " + v.tone}>{v.mark} {v.label}</span>
                  <span className={"badge " + toneFor(report.result.sentiment).tone}>
                    {toneFor(report.result.sentiment).label} sentiment
                  </span>
                  <span className="badge">
                    {report.result.mentioned ? "Known to AI" : "Not found by AI"}
                  </span>
                </div>
                <p className="summary">{report.result.summary}</p>
                <div className="summary-meta">
                  model: groq/openai-gpt-oss-20b · analyzed at {new Date().toLocaleTimeString()}
                </div>
              </div>
            </div>

            <div className="tips">
              <h3>How to get mentioned by AI</h3>
              <ol>
                {report.result.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "24px", flexWrap: "wrap" }}>
              <button className="btn ghost" onClick={() => speak("Your brand " + report.brand + " has a visibility score of " + report.result.score + " out of 100. " + report.result.summary)}>
                🔊 Listen to report
              </button>
              <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(report.result.summary); setStatus("Copied to clipboard ✓"); }}>
                ⧉ Copy summary
              </button>
            </div>
          </section>
        )}

        {/* compare */}
        <section className="card" id="compare">
          <h2>⚔️ Competitor compare</h2>
          <p style={{ color: "var(--color-muted)", fontSize: "0.95rem", marginBottom: "12px" }}>
            Same LLM, same questions — apne brand ko competitors ke against measure karo.
          </p>
          <div className="scan-row" style={{ marginBottom: "8px" }}>
            <div className="scan-input-wrap">
              <input
                className="scan-input"
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCompetitor(); }}
                placeholder="Main brand (jisko compare karna hai)…"
                aria-label="Main brand for comparison"
                disabled={comparing}
              />
            </div>
            <button className="btn ghost" onClick={addCompetitor} disabled={comparing}>
              + Add as base
            </button>
          </div>

          <div className="chips">
            {competitors.map((c) => (
              <span className="chip" key={c}>
                {c}
                <button onClick={() => removeCompetitor(c)} aria-label={"Remove " + c}>✕</button>
              </span>
            ))}
            {!competitors.length && (
              <span className="empty-note">Abhi koi competitor nahi — neeche ek add karo.</span>
            )}
          </div>

          <div className="scan-row">
            <div className="scan-input-wrap">
              <input
                className="scan-input"
                type="text"
                placeholder="Competitor ka naam… (e.g. Zomato)"
                aria-label="Competitor name"
                id="comp-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = e.target.value.trim();
                    if (v) { setCompetitors((prev) => (prev.includes(v) ? prev : [...prev, v])); e.target.value = ""; }
                  }
                }}
                disabled={comparing}
              />
            </div>
            <button
              className="btn"
              onClick={() => {
                const el = document.getElementById("comp-input");
                const val = el.value.trim();
                if (val) { setCompetitors((prev) => (prev.includes(val) ? prev : [...prev, val])); el.value = ""; }
                runCompare();
              }}
              disabled={comparing || competitors.length === 0}
            >
              {comparing ? "Comparing…" : "Compare now"}
            </button>
          </div>

          {compare.length > 0 && (
            <div className="compare-bars fade-in" style={{ marginTop: "28px" }}>
              {compare.map((r) => {
                const sc = r.ok ? clampScore(r.score) : 0;
                const max = Math.max(1, ...compare.map((x) => (x.ok ? clampScore(x.score) : 0)));
                return (
                  <div className="cbar-row" key={r.brand}>
                    <div className="cbar-label">
                      <span>{r.brand}</span>
                      <span><b>{r.ok ? sc : "—"}</b> / 100</span>
                    </div>
                    <div className="cbar-track">
                      <div className="cbar-fill" style={{ width: r.ok ? (sc / max) * 100 + "%" : "0%" }} />
                    </div>
                    {!r.ok && <div style={{ fontSize: "0.8rem", color: "var(--color-bad)", marginTop: "4px" }}>⚠ {r.error}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* history */}
        <section className="card" id="history">
          <h2>🕘 Recent scans</h2>
          {history.length ? (
            <div className="hist">
              {history.map((h) => (
                <button key={h.brand} className="hist-btn" onClick={() => { setBrand(h.brand); setReport(null); }}>
                  {h.brand} · {h.score}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">Abhi koi scan nahi hua — upar pehla scan karo.</p>
          )}
        </section>
      </main>

      {/* footer */}
      <footer>
        <p className="footer-statement">
          In a world where AI reads the internet, <span className="hl">brands that AI can see are the brands that get chosen</span>.
        </p>
        <div className="footer-tags">
          <span>open source · MIT</span>
          <span>groq-powered</span>
          <span>server-side keys</span>
          <span>voice-first</span>
        </div>
        <p className="footer-base">
          Built for a hackathon ·{" "}
          <a href="https://github.com/SPARKEDIX/ganai-project" target="_blank" rel="noopener noreferrer">
            view source on GitHub
          </a>
        </p>
      </footer>

      {/* ——— Crystal Ball overlay ——— */}
      {ballOpen && (
        <div className="veil" role="dialog" aria-modal="true" aria-label="Crystal ball voice conversation">
          <div className="ball-stage">
            <div className={"ball " + ballState}>
              <div className="ball-core" />
              <div className="ball-ring r1" />
              <div className="ball-ring r2" />
              <div className="ball-ring r3" />
              <span className="spark s1" />
              <span className="spark s2" />
              <span className="spark s3" />
              <span className="ball-glow" />
            </div>

            <div className="ball-status">
              {ballState === "listening" && "🎙 Listening… bolo"}
              {ballState === "thinking" && "🌀 Oracle soch raha hai…"}
              {ballState === "speaking" && "🔊 Speaking…"}
              {ballState === "idle" && "Tap ball to talk"}
            </div>

            <div className="ball-transcript" aria-live="polite">
              {transcript.map((t, i) => (
                <div key={i} className={"bubble " + t.who}>
                  {t.text}
                </div>
              ))}
              {!transcript.length && (
                <p className="empty-note">Crystal ball tumhara voice assistant hai — ball dabao aur bolo. Ye apne aap sunta-jawab deta hai.</p>
              )}
            </div>

            <div className="ball-controls">
              <button className="btn" onClick={toggleBallTalk} disabled={ballState === "thinking"}>
                {ballState === "speaking" ? "⏹ Stop" : "🎙 Talk"}
              </button>
              <button className="btn ghost" onClick={closeBall}>
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
