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

    const prompt = `Analyze if this text is AI-generated. Reply with ONLY a JSON object.
Use integers 0-100 for all scores. Keep all "note" and "reasoning" values under 60 characters.

Text: ${text.slice(0, 800)}

JSON:`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 }
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
    
    const result = JSON.parse(raw.slice(start, end + 1));

    // Normalize all scores to integers 0-100
    const normalize = (v) => Math.round(Math.min(100, Math.max(0, (v > 1 ? v : v * 100))));
    const score = normalize(result.overall_score ?? 50);

    const sig = result.signals ?? {};
    const normSig = {};
    for (const key of ['text_patterns','structural','vocabulary','style_consistency']) {
      normSig[key] = {
        score: normalize(sig[key]?.score ?? 50),
        note: (sig[key]?.note || '').slice(0,80)
      };
    }

    res.status(200).json({
      overall: score,
      verdict: result.verdict ?? 'Analysis complete',
      confidence: result.confidence ?? 'Medium',
      signals: normSig,
      reasoning: (result.reasoning || '').slice(0, 300),
      ai_percent: normalize(result.ai_percent ?? score),
      mixed_percent: normalize(result.mixed_percent ?? 10),
      human_percent: normalize(result.human_percent ?? Math.max(0, 100 - score - 10)),
      ai_sentences: result.ai_sentences ?? []
    });

  } catch (err) {
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
