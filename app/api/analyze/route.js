import { NextResponse } from "next/server";

// ——— Security: key sirf server-side. Kabhi client ko mat bhejna ———
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
];

const MAX_BRANDS = 6;
const MAX_LEN = 120;
const TIMEOUT_MS = 30000;

// ——— Simple per-process rate limit (Vercel serverless: per-instance) ———
const hitMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 15;
  const bucket = hitMap.get(ip) || { count: 0, t: now };
  if (now - bucket.t > windowMs) {
    hitMap.set(ip, { count: 1, t: now });
    return false;
  }
  bucket.count += 1;
  hitMap.set(ip, bucket);
  return bucket.count > max;
}

function buildPrompt(brand) {
  return `You are a brand visibility analyst. A user wants to know how visible their brand "${brand}" is to AI assistants and the internet at large.

Reply with ONLY valid JSON (no markdown, no commentary, no extra keys):
{"mentioned": true, "sentiment": "positive|neutral|negative", "summary": "...", "tips": ["tip1", "tip2", "tip3"]}

Rules:
- mentioned=true ONLY if the brand is a recognizable, real entity (company, product, app, creator, org).
- sentiment = how the AI perceives the brand overall.
- summary = 2-3 sentences explaining what is known/associated with the brand. If not mentioned/known, say so plainly and suggest how it could become known.
- tips = exactly 3 actionable, specific ways to get mentioned more by AI (citations, structured data, content, PR, etc.).`;
}

function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
  }
  return null;
}

async function callGroq(prompt) {
  let lastErr = null;
  for (const model of MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 900,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data.error?.message || `Groq ${res.status}`);
        continue;
      }
      const text = data.choices?.[0]?.message?.content || "";
      return text;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Groq call failed");
}

function scoreFor(res) {
  if (!res) return 0;
  let s = res.mentioned ? 60 : 10;
  if (res.sentiment === "positive") s += 35;
  else if (res.sentiment === "neutral") s += 15;
  else if (res.sentiment === "negative") s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export async function POST(req) {
  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: GROQ_API_KEY missing." },
      { status: 500 }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  if (rateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests — thoda ruk ke dobara try karo." },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawBrands = Array.isArray(body.brands) ? body.brands : [];
  const brands = [...new Set(
    rawBrands
      .map((b) => String(b).trim())
      .filter(Boolean)
      .slice(0, MAX_BRANDS)
      .map((b) => b.slice(0, MAX_LEN))
  )];

  if (!brands.length) {
    return NextResponse.json({ error: "Kam se kam ek brand naam do." }, { status: 400 });
  }

  const results = await Promise.all(
    brands.map(async (brand) => {
      try {
        const text = await callGroq(buildPrompt(brand));
        const res = parseJSON(text);
        if (!res) throw new Error("Model response valid JSON nahi tha.");
        return {
          brand,
          ok: true,
          score: scoreFor(res),
          mentioned: !!res.mentioned,
          sentiment: ["positive", "neutral", "negative"].includes(res.sentiment)
            ? res.sentiment
            : "neutral",
          summary: String(res.summary || "").slice(0, 600),
          tips: Array.isArray(res.tips) ? res.tips.map((t) => String(t).slice(0, 240)).slice(0, 3) : [],
        };
      } catch (e) {
        return { brand, ok: false, error: (e.message || "Analysis failed").slice(0, 240) };
      }
    })
  );

  return NextResponse.json({ results });
}
