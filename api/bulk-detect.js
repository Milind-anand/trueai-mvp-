// VeriAI — Bulk AI Detection API
// Handles Teacher (essay), Writer (article), UPSC modes
// Env vars: GEMINI_KEY, GEMINI_KEY_2, GEMINI_KEY_3

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

async function callGemini(prompt) {
  for (let attempt = 0; attempt < Math.max(KEYS.length, 1); attempt++) {
    const key = getNextKey();
    if (!key) throw new Error('No API keys configured');
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
        })
      }
    );
    if (r.status === 429) { await sleep(1000); continue; }
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const msg = e.error?.message || 'Gemini error ' + r.status;
      if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) { await sleep(1000); continue; }
      throw new Error(msg);
    }
    const data = await r.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  }
  throw new Error('Rate limit reached. Please wait 60 seconds and try again.');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseJSON(raw) {
  try {
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch {
    // Try extracting JSON object from within the text
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

function buildPrompt(text, threshold, mode) {
  const modeContext = {
    teacher:  'This is a student essay or academic assignment. Students sometimes use AI to write essays and pass them as their own work.',
    writer:   'This is a professional article, blog post or written content submitted for publication or client delivery.',
    upsc:     'This is a UPSC competitive exam essay. Candidates sometimes use AI to memorize structured answers. Be sensitive to AI-typical patterns like perfect paragraph structure, overuse of formal transitions, and uniform sentence length.',
  }[mode] || 'This is a document to be analyzed for AI-generated content.';

  return `You are an expert AI content detector with deep training in linguistic analysis. ${modeContext}

Analyze the text below and identify the EXACT sentences or phrases that show strong AI-generation patterns.

Return ONLY a valid JSON object — no markdown fences, no explanation, just the raw JSON:

{
  "overall_score": <integer 0-100, the overall probability the ENTIRE document is AI-generated>,
  "flagged_lines": [
    {
      "text": "<copy the exact sentence or phrase from the document, max 200 chars>",
      "probability": <integer between ${threshold} and 100>,
      "reason": "<max 8 words explaining the AI signal, e.g. 'Formulaic transition, uniform sentence length'>"
    }
  ],
  "summary": "<2 sentences: (1) overall assessment, (2) specific recommendation for the reader>"
}

Detection rules:
- AI signals to look for: formulaic transitions (furthermore, moreover, in conclusion), perfectly uniform paragraph structure, repetitive sentence length, lack of personal voice, overuse of passive voice, generic/safe word choices, absence of errors or colloquialisms
- Only flag lines with AI probability >= ${threshold}%
- Maximum 8 flagged lines (pick the most clear-cut ones)
- If no lines meet the threshold, return empty flagged_lines array and explain in summary
- overall_score should reflect the WHOLE document, not just flagged lines
- Quote text EXACTLY as it appears in the document

Document to analyze:
---
${text.slice(0, 3500)}
---`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const { files, threshold = 75, mode = 'teacher' } = req.body || {};

  if (!files || !Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: 'No files provided' });
  }

  if (!KEYS.length) {
    return res.status(500).json({ error: 'No API keys configured. Add GEMINI_KEY to Vercel environment variables.' });
  }

  const results = [];

  for (const file of files.slice(0, 3)) { // max 3 files
    if (!file.text || file.text.trim().length < 30) {
      results.push({
        filename: file.name || 'Unknown file',
        overall_score: 0,
        flagged_lines: [],
        summary: 'Could not extract enough text from this file. Try copy-pasting the content into the Text tab instead.',
        error: true
      });
      continue;
    }

    try {
      const prompt = buildPrompt(file.text, threshold, mode);
      const raw = await callGemini(prompt);
      const parsed = parseJSON(raw);

      if (parsed && typeof parsed.overall_score === 'number') {
        results.push({
          filename: file.name || 'Unknown file',
          overall_score: Math.min(100, Math.max(0, Math.round(parsed.overall_score))),
          flagged_lines: (parsed.flagged_lines || [])
            .filter(l => l && l.text && typeof l.probability === 'number' && l.probability >= threshold)
            .slice(0, 8)
            .map(l => ({
              text: String(l.text).slice(0, 250),
              probability: Math.min(100, Math.max(threshold, Math.round(l.probability))),
              reason: String(l.reason || '').slice(0, 80)
            })),
          summary: String(parsed.summary || 'Analysis complete.').slice(0, 400)
        });
      } else {
        // Fallback: extract score from raw text
        const numMatch = raw.match(/\b(\d{1,3})\b/);
        const score = Math.min(100, parseInt(numMatch?.[1] || '50'));
        results.push({
          filename: file.name || 'Unknown file',
          overall_score: score,
          flagged_lines: [],
          summary: `Overall AI probability: approximately ${score}%. Detailed line-level analysis was not available for this file.`
        });
      }
    } catch (err) {
      results.push({
        filename: file.name || 'Unknown file',
        overall_score: 0,
        flagged_lines: [],
        summary: 'Analysis failed: ' + err.message,
        error: true
      });
    }

    // Rate limit buffer between files
    if (files.length > 1) await sleep(600);
  }

  return res.status(200).json({ results });
}
