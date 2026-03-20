// TrueAI v4 — Secure Gemini API Proxy
// GEMINI_KEY stored in Vercel Environment Variables only

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) {
    res.status(500).json({ error: 'GEMINI_KEY not set in Vercel Environment Variables' });
    return;
  }

  try {
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'No text provided' }); return; }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini API error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    const raw = data.candidates[0].content.parts[0].text
      .trim().replace(/```json\n?|```/g, '').trim();

    const result = JSON.parse(raw);

    res.status(200).json({
      overall: result.overall_score ?? result.overall ?? 50,
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
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
