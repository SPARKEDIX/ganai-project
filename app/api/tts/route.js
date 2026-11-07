import { NextResponse } from "next/server";

// ——— Text-to-Speech routing ———
// Default: browser-native speech (free, zero-key). Agar koi TTS provider
// (e.g. vach_) configured ho, yahan proxy karo.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) {
    return NextResponse.json({ error: "Text khali hai." }, { status: 400 });
  }

  const base = process.env.VACH_BASE_URL;
  const key = process.env.VACH_API_KEY;

  // Agar koi TTS provider configure hai, yahan usse audio lo:
  if (base && key) {
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ text, voice: "F2", format: "wav" }),
      });
      if (res.ok && res.headers.get("content-type")?.includes("audio")) {
        const buf = await res.arrayBuffer();
        return new NextResponse(Buffer.from(buf), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        });
      }
    } catch {
      // provider failed — fall through to native
    }
  }

  // Default: client browser-native speech (speechSynthesis)
  return NextResponse.json({ mode: "native" });
}
