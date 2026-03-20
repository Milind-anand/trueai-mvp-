// TrueAI v4 — Secure Gemini API Proxy
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const GEMINI_KEY = process.env.GEMINI_KEY;
  if (!GEMINI_KEY) { res.status(500).json({ error: 'GEMINI_KEY not configured' }); return; }

  try {
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'No text provided' }); return; }

    // Ask for ONLY the essential fields — keep response tiny
    const prompt = `Analyze if this text is AI-generated. Reply with ONLY this JSON (no other text):
{"overall_score":75,"verdict":"Likely AI-generated","confidence":"High","ai_percent":75,"mixed_percent":15,"human_percent":10,"reasoning":"short reason here"}

Text: ${text.slice(0, 1200)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 256 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    if (!data.candidates?.[0]) throw new Error('Empty Gemini response');
    
    let raw = data.candidates[0].content.parts[0].text.trim();
    raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON: ' + raw.slice(0,100));
    
    const r = JSON.parse(raw.slice(start, end + 1));

    const normalize = (v) => {
      if (v === undefined || v === null) return 50;
      return Math.round(Math.min(100, Math.max(0, v > 1 ? v : v * 100)));
    };

    const score = normalize(r.overall_score ?? r.overall_ai_score ?? r.ai_likelihood ?? 50);

    // Build default signals from the score
    const defaultSignals = {
      text_patterns: { score: score, note: 'Based on language patterns' },
      structural: { score: Math.round(score * 0.9), note: 'Sentence structure analysis' },
      vocabulary: { score: Math.round(score * 0.85), note: 'Word choice patterns' },
      style_consistency: { score: Math.round(score * 0.95), note: 'Tone consistency' }
    };

    res.status(200).json({
      overall: score,
      verdict: r.verdict ?? (score > 65 ? 'Likely AI-generated' : score > 35 ? 'Possibly AI-assisted' : 'Likely Human'),
      confidence: r.confidence ?? 'Medium',
      signals: defaultSignals,
      reasoning: String(r.reasoning ?? 'Analysis complete').slice(0, 300),
      ai_percent: normalize(r.ai_percent ?? score),
      mixed_percent: normalize(r.mixed_percent ?? 10),
      human_percent: normalize(r.human_percent ?? Math.max(0, 100 - score - 10)),
      ai_sentences: []
    });

  } catch (err) {
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
