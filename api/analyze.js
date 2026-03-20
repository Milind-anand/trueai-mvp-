// TrueAI — Gemini API Proxy
// Node 18 runtime — fetch is built-in

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const KEY = process.env.GEMINI_KEY;
  if (!KEY) { res.status(500).json({ error: 'GEMINI_KEY not configured' }); return; }

  try {
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'No text provided' }); return; }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
        })
      }
    );

    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error?.message || 'Gemini error ' + r.status);
    }

    const data = await r.json();
    const raw = data.candidates[0].content.parts[0].text
      .trim().replace(/```json\n?|```/g, '').trim();
    const result = JSON.parse(raw);

    res.status(200).json({
      overall: result.overall_score ?? 50,
      verdict: result.verdict ?? 'Analysis complete',
      confidence: result.confidence ?? 'Medium',
      signals: result.signals ?? {},
      reasoning: result.reasoning ?? '',
      ai_percent: result.ai_percent ?? result.overall_score ?? 50,
      mixed_percent: result.mixed_percent ?? 10,
      human_percent: result.human_percent ?? Math.max(0, 100 - (result.overall_score ?? 50) - 10),
      ai_sentences: result.ai_sentences ?? []
    });

  } catch (err) {
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
