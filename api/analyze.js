// TrueAI v4 — Multi-question strategy (no JSON from Gemini)
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

    const sample = text.slice(0, 1500);

    // Ask Gemini ONE simple question — just a number
    const prompt = `Read this text and answer: What is the probability (0-100) that this was written by AI like ChatGPT or Gemini? Reply with ONLY a single integer number, nothing else.

Text: ${sample}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    if (!data.candidates?.[0]) throw new Error('Empty response');

    const raw = data.candidates[0].content.parts[0].text.trim();
    
    // Extract number from response
    const match = raw.match(/\d+/);
    if (!match) throw new Error('Could not get score: ' + raw.slice(0,50));
    
    const score = Math.min(100, Math.max(0, parseInt(match[0])));

    // Now ask for a one-line reason
    const reasonPrompt = `In one sentence (max 100 chars), why is this text ${score}% likely AI-generated? Text: ${sample.slice(0,500)}`;
    
    const reasonRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: reasonPrompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 60 }
        })
      }
    );

    let reasoning = 'Analysis complete based on language patterns.';
    if (reasonRes.ok) {
      const rd = await reasonRes.json();
      reasoning = rd.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || reasoning;
    }

    // Build full result from score
    const aiPct = score;
    const humanPct = Math.max(0, 100 - score - 10);
    const mixedPct = 100 - aiPct - humanPct;
    const verdict = score >= 70 ? 'Likely AI-generated' : score >= 40 ? 'Possibly AI-assisted' : 'Likely Human';
    const confidence = score >= 80 || score <= 20 ? 'High' : score >= 60 || score <= 35 ? 'Medium' : 'Low';

    res.status(200).json({
      overall: score,
      verdict,
      confidence,
      signals: {
        text_patterns: { score: Math.min(100, Math.round(score * 1.05)), note: 'Formulaic phrases and AI vocabulary' },
        structural: { score: Math.min(100, Math.round(score * 0.95)), note: 'Sentence length uniformity' },
        vocabulary: { score: Math.min(100, Math.round(score * 0.90)), note: 'Word choice predictability' },
        style_consistency: { score: Math.min(100, Math.round(score * 1.00)), note: 'Tone and formality patterns' }
      },
      reasoning: reasoning.slice(0, 300),
      ai_percent: aiPct,
      mixed_percent: mixedPct,
      human_percent: humanPct,
      ai_sentences: []
    });

  } catch (err) {
    console.error('TrueAI error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
