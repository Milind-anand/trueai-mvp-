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

    const prompt = `Analyze if this text is AI-generated. Respond with ONLY valid JSON, no other text.

Text to analyze: "${text.slice(0, 1000)}"

Respond with exactly this JSON structure (replace values with your analysis):
{"overall_score":75,"verdict":"Likely AI-generated","confidence":"High","ai_percent":75,"mixed_percent":15,"human_percent":10,"signals":{"text_patterns":{"score":80,"note":"AI phrases detected"},"structural":{"score":70,"note":"Uniform structure"},"vocabulary":{"score":65,"note":"Generic words"},"style_consistency":{"score":75,"note":"Consistent tone"}},"reasoning":"This text shows AI patterns.","ai_sentences":[0,1]}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 500 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    
    // Check if response exists
    if (!data.candidates || !data.candidates[0]) {
      throw new Error('Empty response from Gemini: ' + JSON.stringify(data).slice(0,200));
    }
    
    let raw = data.candidates[0].content.parts[0].text.trim();
    
    // Remove markdown code blocks if present
    raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Extract JSON - find first { and last }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    
    if (start === -1 || end === -1) {
      // Return raw response in error so we can see what Gemini said
      throw new Error('Gemini returned: ' + raw.slice(0, 200));
    }
    
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
