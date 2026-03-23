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

async function callGemini(prompt, base64Data, mimeType) {
  for (let attempt = 0; attempt < Math.max(KEYS.length, 1); attempt++) {
    const key = getNextKey();
    if (!key) throw new Error('No API keys configured');

    // Build parts: if base64 provided, send as inline document + text prompt
    let parts;
    if (base64Data && mimeType) {
      parts = [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        },
        { text: prompt }
      ];
    } else {
      parts = [{ text: prompt }];
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
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
  if (!raw) return null;
  // Remove markdown code fences
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Try direct parse
  try { return JSON.parse(s); } catch {}
  // Find outermost { ... }
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  // Try fixing common issues: trailing commas, unescaped quotes in values
  try {
    const fixed = s
      .replace(/,\s*([}\]])/g, '$1')   // trailing commas
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // unquoted keys
    const s2 = fixed.slice(fixed.indexOf('{'), fixed.lastIndexOf('}') + 1);
    return JSON.parse(s2);
  } catch {}
  return null;
}

function buildPrompt(threshold, mode) {
  const ctx = {
    teacher: 'student essay or academic assignment',
    writer:  'professional article or blog post',
    upsc:    'UPSC competitive exam essay',
  }[mode] || 'document';

  return `Analyze this ${ctx} for AI-generated content. You MUST identify specific sentences.

RESPOND WITH ONLY THIS JSON. No markdown. No code fences. No text before or after. Start your response with { and end with }

{"overall_score":NUMBER,"flagged_lines":[{"text":"SENTENCE","probability":NUMBER,"reason":"REASON"}],"summary":"SUMMARY"}

CRITICAL RULES:
1. overall_score = integer 0-100 (whole document AI probability)
2. flagged_lines = array of sentences that are AI-written with probability >= ${threshold}
3. If overall_score >= 50, you MUST include at least 3-5 flagged_lines. Never return empty array if score is high.
4. Each flagged line: "text" = exact sentence from document (max 180 chars), "probability" = ${threshold} to 100, "reason" = 3-5 words
5. AI signals to detect: starts with "Furthermore"/"Moreover"/"Additionally", perfect paragraph structure, no typos, generic phrasing, passive voice, uniform sentence length, lacks personal anecdotes
6. summary = 2 sentences: verdict + recommendation
7. Max 8 flagged lines total

Example flagged line: {"text":"Furthermore, the geopolitical tensions have escalated significantly.","probability":88,"reason":"Formulaic transition word"}`;
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

  for (const file of files.slice(0, 3)) {
    const isPDF = (file.mimeType || '').includes('pdf') || (file.name || '').endsWith('.pdf');
    // Only use base64 for PDFs — Gemini inline_data doesn't reliably support DOCX
    const hasBase64 = isPDF && file.base64 && file.base64.length > 100;
    const hasText   = file.text && file.text.trim().length > 30;

    if (!hasBase64 && !hasText) {
      results.push({
        filename: file.name || 'Unknown file',
        overall_score: 0,
        flagged_lines: [],
        summary: 'Could not read this file. Try copy-pasting the content into the Text tab instead.',
        error: true
      });
      continue;
    }

    try {
      const prompt = hasBase64
        ? buildPrompt(threshold, mode) + '\n\nAnalyze the PDF document provided.'
        : buildPrompt(threshold, mode) + `\n\nDOCUMENT:\n---\n${file.text.slice(0, 4000)}\n---`;

      const raw = await callGemini(
        prompt,
        hasBase64 ? file.base64 : null,
        hasBase64 ? 'application/pdf' : null
      );

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
        const numMatch = raw.match(/\b(\d{1,3})\b/);
        const score = Math.min(100, parseInt(numMatch?.[1] || '50'));
        results.push({
          filename: file.name || 'Unknown file',
          overall_score: score,
          flagged_lines: [],
          summary: `Overall AI probability: approximately ${score}%. Detailed line-level analysis was not available.`
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

    if (files.length > 1) await sleep(600);
  }

  return res.status(200).json({ results });
}
