// VeriAI — CV Ranking API
// Scores each CV against a job description and returns ranked results
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGemini(prompt, base64Data, mimeType) {
  for (let attempt = 0; attempt < Math.max(KEYS.length, 1); attempt++) {
    const key = getNextKey();
    if (!key) throw new Error('No API keys configured');

    let parts;
    if (base64Data && mimeType) {
      parts = [
        { inline_data: { mime_type: mimeType, data: base64Data } },
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

function parseJSON(raw) {
  if (!raw) return null;
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  try {
    const fixed = s.replace(/,\s*([}\]])/g, '$1').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    return JSON.parse(fixed.slice(fixed.indexOf('{'), fixed.lastIndexOf('}') + 1));
  } catch {}
  return null;
}

function buildCVPrompt(jd, cvText, cvName, cvIsBase64, jdIsBase64) {
  const cvSection = cvIsBase64
    ? `CANDIDATE CV (${cvName}): [attached PDF — read fully]`
    : `CANDIDATE CV (${cvName}):\n${cvText.slice(0, 2800)}`;

  const jdSection = jdIsBase64
    ? `JOB DESCRIPTION: [attached PDF/document — read fully]`
    : `JOB DESCRIPTION:\n${jd.slice(0, 1200)}`;

  return `You are a senior HR recruiter. Score this candidate's CV against the job description.

YOU MUST RESPOND WITH ONLY A JSON OBJECT. No text before or after. No markdown. No code fences. Start with { and end with }.

Required format:
{"candidate_name":"NAME_FROM_CV","match_score":INTEGER_0_TO_100,"matched_attributes":[{"attribute":"JD_REQUIREMENT","evidence":"CV_EVIDENCE_MAX_20_WORDS","score":INTEGER_1_TO_10}],"missing":["ABSENT_JD_REQUIREMENT"],"strengths":"ONE_SENTENCE","concern":"ONE_SENTENCE_OR_EMPTY","summary":"TWO_SENTENCES"}

Rules:
- candidate_name: extract from CV header
- match_score: 0-100 (90+=exceptional, 70-89=strong, 50-69=moderate, 30-49=weak)
- matched_attributes: list ALL JD requirements found in CV with evidence (max 8)
- missing: JD requirements clearly absent from CV (max 5)
- Be honest — 50 = average fit, not rounded up
- Read the ENTIRE CV before scoring

${jdSection}

${cvSection}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const { jd, jdBase64, jdMimeType, cvs } = req.body || {};

  const jdText = (jd || '').trim();
  const hasJDFile = jdBase64 && jdBase64.length > 100;

  if (!hasJDFile && jdText.length < 30) {
    return res.status(400).json({ error: 'Job description is required (minimum 30 characters)' });
  }
  if (!cvs || !Array.isArray(cvs) || !cvs.length) {
    return res.status(400).json({ error: 'At least one CV is required' });
  }
  if (!KEYS.length) {
    return res.status(500).json({ error: 'No API keys configured. Add GEMINI_KEY to Vercel environment variables.' });
  }

  const ranked = [];

  for (const cv of cvs.slice(0, 5)) {
    const isPDF = (cv.mimeType || '').includes('pdf') || (cv.name || '').endsWith('.pdf');
    // Only use base64 for PDFs — DOCX must use text extraction
    const hasBase64 = isPDF && cv.base64 && cv.base64.length > 100;
    const hasText   = cv.text && cv.text.trim().length > 30;

    if (!hasBase64 && !hasText) {
      ranked.push({
        filename: cv.name || 'CV',
        candidate_name: 'Unknown Candidate',
        match_score: 0,
        matched_attributes: [],
        missing: ['CV could not be read — try a text-based PDF or Word document'],
        strengths: '',
        concern: 'Ask candidate to submit as a text-based PDF or typed Word document.',
        summary: 'Unable to analyze this CV due to extraction failure.'
      });
      continue;
    }

    try {
      const prompt = buildCVPrompt(jdText, cv.text || '', cv.name || 'CV', hasBase64, hasJDFile);
      const raw = await callGemini(
        prompt,
        hasBase64 ? cv.base64 : null,
        hasBase64 ? 'application/pdf' : null
      );
      const parsed = parseJSON(raw);

      if (parsed && typeof parsed.match_score === 'number') {
        ranked.push({
          filename: cv.name || 'CV',
          candidate_name: String(parsed.candidate_name || 'Unknown Candidate').slice(0, 80),
          match_score: Math.min(100, Math.max(0, Math.round(parsed.match_score))),
          matched_attributes: (parsed.matched_attributes || [])
            .filter(a => a && a.attribute)
            .slice(0, 8)
            .map(a => ({
              attribute: String(a.attribute).slice(0, 60),
              evidence: String(a.evidence || '').slice(0, 120),
              score: Math.min(10, Math.max(1, Math.round(a.score || 5)))
            })),
          missing: (parsed.missing || [])
            .filter(Boolean)
            .slice(0, 5)
            .map(m => String(m).slice(0, 80)),
          strengths: String(parsed.strengths || '').slice(0, 200),
          concern: String(parsed.concern || '').slice(0, 200),
          summary: String(parsed.summary || '').slice(0, 300)
        });
      } else {
        // Fallback
        ranked.push({
          filename: cv.name || 'CV',
          candidate_name: 'Unknown Candidate',
          match_score: 50,
          matched_attributes: [],
          missing: [],
          strengths: 'CV was processed but detailed analysis could not be parsed.',
          concern: '',
          summary: 'Manual review recommended for this candidate.'
        });
      }
    } catch (err) {
      ranked.push({
        filename: cv.name || 'CV',
        candidate_name: 'Unknown Candidate',
        match_score: 0,
        matched_attributes: [],
        missing: [],
        strengths: '',
        concern: 'Analysis failed: ' + err.message,
        summary: 'Could not analyze this CV. Try again or contact support.'
      });
    }

    // Rate limit buffer between CVs
    if (cvs.length > 1) await sleep(700);
  }

  // Sort by match score descending
  ranked.sort((a, b) => b.match_score - a.match_score);

  return res.status(200).json({ ranked });
}
