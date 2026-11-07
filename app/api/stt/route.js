import { NextResponse } from "next/server";

// ——— Speech-to-Text via Groq Whisper (server-side, sab browsers mein chalta hai) ———
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const MAX_AUDIO_B64 = 14 * 1024 * 1024; // ~10MB audio

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

  const b64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!b64) {
    return NextResponse.json({ error: "Koi audio nahi mila." }, { status: 400 });
  }
  if (b64.length > MAX_AUDIO_B64) {
    return NextResponse.json({ error: "Audio bahut bada hai (max ~10MB)." }, { status: 413 });
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(b64, "base64");
  } catch {
    return NextResponse.json({ error: "Audio decode nahi hua." }, { status: 400 });
  }
  if (audioBuffer.length < 100) {
    return NextResponse.json({ error: "Audio bahut chhota hai — dobara bolo." }, { status: 400 });
  }

  const mime = typeof body.mime === "string" && body.mime ? body.mime : "audio/webm";

  try {
    const form = new FormData();
    form.append("model", "whisper-large-v3");
    form.append("file", new Blob([audioBuffer], { type: mime }), "audio");
    form.append("language", "en");
    form.append("temperature", "0");

    const res = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || `Whisper ${res.status}` }, { status: 502 });
    }
    const text = String(data.text || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Awaaz samajh nahi aayi — thoda clear bolo." }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: "STT service error: " + (e.message || "unknown") }, { status: 502 });
  }
}
