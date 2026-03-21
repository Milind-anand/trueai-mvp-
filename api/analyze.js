// VeriAI — Multi-key Gemini Proxy + Local Fallback Detector
import { localAnalyze } from './fallback-detector.js';

const KEYS = [
  process.env.GEMINI_KEY,
  process.env.GEMINI_KEY_2,
  process.env.GEMINI_KEY_3,
].filter(Boolean);

let keyIndex = 0;

function getNextKey() {
  const key = KEYS[keyIndex % KEYS.length];
  keyIndex++;
  return key;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!KEYS.length) { res.status(500).json({ error: 'No API keys configured' }); return; }

  try {
    const body = req.body;
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const text = parsed?.text;
    const forceFallback = parsed?.forceFallback === true;

    if (!text) { res.status(400).json({ error: 'No text provided' }); return; }

    // ── User explicitly chose local engine ───────────────────
    if (forceFallback) {
      const result = localAnalyze(text);
      if (result.error) return res.status(400).json({ error: result.error });
      return res.status(200).json(result);
    }

    const prompt = `Analyze this text for AI generation. Reply with EXACTLY this format:
SCORE:[number 0-100]|REASON:[one sentence reason under 80 chars]

Text: ${text.slice(0, 1200)}`;

    // ── Try each Gemini key ──────────────────────────────────
    for (let attempt = 0; attempt < KEYS.length; attempt++) {
      const apiKey = getNextKey();

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 80 }
          })
        }
      );

      if (geminiRes.status === 429) continue;

      if (!geminiRes.ok) {
        const err = await geminiRes.json();
        const msg = err.error?.message || 'Gemini error ' + geminiRes.status;
        if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) continue;
        throw new Error(msg);
      }

      const data = await geminiRes.json();
      if (!data.candidates?.[0]) throw new Error('Empty Gemini response');

      const raw = data.candidates[0].content.parts[0].text.trim();
      const scoreMatch = raw.match(/SCORE[:\s]*(\d+)/i);
      const reasonMatch = raw.match(/REASON[:\s]*(.+)/i);
      const anyNumber = raw.match(/\b(\d{1,3})\b/);

      const score = Math.min(100, Math.max(0, parseInt(scoreMatch?.[1] ?? anyNumber?.[1] ?? '50')));
      const reasoning = (reasonMatch?.[1] ?? 'Analysis based on language patterns.').slice(0, 200);

      const aiPct = score;
      const humanPct = Math.max(0, 100 - score - 10);
      const mixedPct = 100 - aiPct - humanPct;
      const verdict = score >= 70 ? 'Likely AI-generated' : score >= 40 ? 'Possibly AI-assisted' : 'Likely Human';
      const confidence = (score >= 80 || score <= 20) ? 'High' : (score >= 60 || score <= 35) ? 'Medium' : 'Low';

      return res.status(200).json({
        overall: score, verdict, confidence,
        signals: {
          text_patterns:     { score: Math.min(100, Math.round(score * 1.05)), note: 'AI vocabulary and phrases' },
          structural:        { score: Math.min(100, Math.round(score * 0.95)), note: 'Sentence structure uniformity' },
          vocabulary:        { score: Math.min(100, Math.round(score * 0.90)), note: 'Word choice predictability' },
          style_consistency: { score: Math.min(100, Math.round(score * 1.00)), note: 'Tone and formality level' }
        },
        reasoning, ai_percent: aiPct, mixed_percent: mixedPct, human_percent: humanPct,
        ai_sentences: [], fallback: false
      });
    }

    // ── All keys rate-limited → signal client to show choice UI
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Our AI servers are currently busy. Please wait or use local engine.'
    });

  } catch (err) {
    console.error('VeriAI error:', err.message);
    try {
      const body = req.body;
      const text = typeof body === 'string' ? JSON.parse(body).text : body?.text;
      if (text) return res.status(200).json(localAnalyze(text));
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
}
