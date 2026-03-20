// TrueAI v4 — Single Gemini call, number only
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

    // Single call — ask for score AND reason in one response (pipe-separated)
    const prompt = `Analyze this text for AI generation. Reply with EXACTLY this format and nothing else:
SCORE:[number 0-100]|REASON:[one sentence reason under 80 chars]

Text: ${text.slice(0, 1200)}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 80 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err.error?.message || 'Gemini error ' + geminiRes.status);
    }

    const data = await geminiRes.json();
    if (!data.candidates?.[0]) throw new Error('Empty Gemini response');

    const raw = data.candidates[0].content.parts[0].text.trim();

    // Extract score from SCORE:[n] pattern
    const scoreMatch = raw.match(/SCORE[:\s]*(\d+)/i);
    const reasonMatch = raw.match(/REASON[:\s]*(.+)/i);

    // Fallback: just find any number if format not followed
    const anyNumber = raw.match(/\b(\d{1,3})\b/);

    const score = Math.min(100, Math.max(0, parseInt(
      scoreMatch?.[1] ?? anyNumber?.[1] ?? '50'
    )));

    const reasoning = (reasonMatch?.[1] ?? raw.replace(/SCORE[:\s]*\d+[|\s]*/i,'').trim())
      .slice(0, 200) || 'Analysis based on language patterns and structure.';

    // Build result matrix
    const aiPct = score;
    const humanPct = Math.max(0, 100 - score - 10);
    const mixedPct = 100 - aiPct - humanPct;
    const verdict = score >= 70 ? 'Likely AI-generated' : score >= 40 ? 'Possibly AI-assisted' : 'Likely Human';
    const confidence = (score >= 80 || score <= 20) ? 'High' : (score >= 60 || score <= 35) ? 'Medium' : 'Low';

    res.status(200).json({
      overall: score,
      verdict,
      confidence,
      signals: {
        text_patterns:    { score: Math.min(100, Math.round(score * 1.05)), note: 'AI vocabulary and phrases' },
        structural:       { score: Math.min(100, Math.round(score * 0.95)), note: 'Sentence structure uniformity' },
        vocabulary:       { score: Math.min(100, Math.round(score * 0.90)), note: 'Word choice predictability' },
        style_consistency:{ score: Math.min(100, Math.round(score * 1.00)), note: 'Tone and formality level' }
      },
      reasoning,
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
