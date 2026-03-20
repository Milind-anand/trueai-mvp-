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

    const prompt = `Analyze if this text is AI-generated or human-written.
Respond with ONLY a JSON object using EXACTLY these field names:
overall_score, verdict, confidence, ai_percent, mixed_percent, human_percent, signals, reasoning, ai_sentences

The signals object must have EXACTLY these keys: text_patterns, structural, vocabulary, style_consistency
Each signal must have: score (integer 0-100) and note (string under 60 chars)

Text to analyze:
${text.slice(0, 1000)}`;

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
    if (start === -1 || end === -1) throw new Error('No JSON: ' + raw.slice(0,150));
    
    const r = JSON.parse(raw.slice(start, end + 1));

    // Handle ANY field name Gemini might use for the main score
    const normalize = (v) => {
      if (v === undefined || v === null) return 50;
      return Math.round(Math.min(100, Math.max(0, v > 1 ? v : v * 100)));
    };

    const score = normalize(
      r.overall_score ?? r.overall_ai_score ?? r.ai_likelihood ?? 
      r.ai_score ?? r.probability ?? r.score ?? 50
    );

    // Handle signals with any structure
    const rawSig = r.signals ?? r.signal_scores ?? r.indicators ?? {};
    const normSig = {};
    const sigKeys = ['text_patterns','structural','vocabulary','style_consistency'];
    sigKeys.forEach(key => {
      const val = rawSig[key] ?? rawSig[key.replace('_',' ')] ?? {};
      normSig[key] = {
        score: normalize(val.score ?? val.value ?? val.probability ?? 50),
        note: String(val.note ?? val.description ?? val.explanation ?? 'Analyzed').slice(0,80)
      };
    });

    res.status(200).json({
      overall: score,
      verdict: r.verdict ?? r.classification ?? r.result ?? (score > 65 ? 'Likely AI-generated' : score > 35 ? 'Possibly AI-assisted' : 'Likely Human'),
      confidence: r.confidence ?? r.confidence_level ?? 'Medium',
      signals: normSig,
      reasoning: String(r.reasoning ?? r.explanation ?? r.analysis ?? 'Analysis complete').slice(0,400),
      ai_percent: normalize(r.ai_percent ?? r.ai_percentage ?? score),
      mixed_percent: normalize(r.mixed_percent ?? r.mixed_percentage ?? 10),
      human_percent: normalize(r.human_percent ?? r.human_percentage ?? Math.max(0, 100 - score - 10)),
      ai_sentences: Array.isArray(r.ai_sentences) ? r.ai_sentences : []
    });

  } catch (err) {
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
