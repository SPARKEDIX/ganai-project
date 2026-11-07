import { NextResponse } from "next/server";

// ——— Crystal-ball oracle: voice-to-voice conversation brain (Groq LLM) ———
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

const MAX_LEN = 500;
const TIMEOUT_MS = 25000;

const SYSTEM = `You are the "Oracle of the Crystal Ball" inside BrandRadar — a mystical but helpful AI assistant that reads the "visible aura" of brands.
You answer in a warm, mysterious but practical tone. Keep replies SHORT: 2-3 sentences, easy to speak aloud.
If the user asks about a brand, give a quick visibility verdict (known/unknown) and one actionable tip.
If the user asks anything else, answer helpfully but briefly.
Never mention that you are an AI model or an API. Stay in character as the oracle.`;

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
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: prompt },
          ],
          temperature: 0.65,
          max_tokens: 220,
        }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error(data.error?.message || `Groq ${res.status}`);
        continue;
      }
      return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Oracle call failed");
}

export async function POST(req) {
  if (!GROQ_API_KEY) {
    return NextResponse.json({ error: "Server misconfigured: GROQ_API_KEY missing." }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = String(body.text || "").trim().slice(0, MAX_LEN);
  if (!text) {
    return NextResponse.json({ error: "Kuch bolo pehle." }, { status: 400 });
  }

  try {
    const reply = await callGroq(text);
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e.message || "Oracle failed" }, { status: 502 });
  }
}
