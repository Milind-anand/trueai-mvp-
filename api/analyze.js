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

    const prompt = `You are an AI content detector. Analyze this text and respond with ONLY a JSON object, nothing else before or after it.

Text: "${text.slice(0, 1500)}"

JSON response (fill in real values):
{"overall_score":0,"verdict":"Likely Human","confidence":"Medium","ai_percent":0,"mixed_percent":10,"human_percent":90,"signals":{"text_patterns":{"score":0,"note":"brief note"},"structural":{"score":0,"note":"brief note"},"vocabulary":{"score":0,"note":"brief note"},"style_consistency":{"score":0,"note":"brief note"}},"reasoning":"Your analysis here.","ai_sentences":[]}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    let raw = data.candidates[0].content.parts[0].text.trim();
    
    // Extract JSON from response — find first { and last }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in Gemini response');
    raw = raw.slice(start, end + 1);

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
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
