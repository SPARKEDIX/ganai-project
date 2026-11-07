# 📡 BrandRadar — AI Visibility Checker

**Check karo ki AI assistants tumhare brand ko jaante hain ya nahi — aur kya kehte hain.**

> Hackathon project · Live demo: `https://brandradar.vercel.app` (deployment ke baad)

## ✨ Kya karta hai

1. User brand ka naam daalta hai (type karke **ya voice se bolke** 🎙)
2. Backend securely **Groq LLM** (`openai/gpt-oss-20b`) se puchta hai — key sirf server-side
3. Result milta hai: **Visibility Score (0–100)** + sentiment + summary + 3 actionable tips
4. **Competitor compare** — same LLM se multiple brands ka score
5. **Listen** button — report speech mein suno (browser native TTS, free)
6. History — recent scans localStorage mein

## 🏗 Tech

- **Next.js 15** (App Router) — frontend + API routes
- **Groq API** — LLM (key `GROQ_API_KEY` env mein, server-side only)
- **Hallmark design system** — atmospheric genre, Night Foundry dark canvas
- **Web Speech API** — STT (mic) + TTS (listen), browser native, koi key nahi
- Deploy: **Vercel** (serverless functions)

## 🔐 Security design

| Cheez | Kaise |
|---|---|
| LLM key | Sirf `process.env.GROQ_API_KEY` — route handler mein. Kabhi client bundle mein nahi |
| Rate limit | Per-IP counter (15 req/min) |
| Input validation | Max 6 brands, 120 chars each, sanitized |
| Voice key (vach_) | Optional — `VACH_API_KEY` env mein, abhi browser-native speech default hai |

## 🚀 Local run

```bash
cd brandradar
npm install
cp .env.example .env.local   # apni keys daalo
npm run dev
# → http://localhost:3000
```

## 📜 License

MIT — free, open source, sabke liye.
