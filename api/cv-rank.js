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
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json'   // ← forces Gemini to emit raw JSON, no fences
          }
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

// ── Primary JSON parser (handles markdown fences + trailing commas) ──
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
    const fixed = s
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    return JSON.parse(fixed.slice(fixed.indexOf('{'), fixed.lastIndexOf('}') + 1));
  } catch {}
  return null;
}

// ── Partial extractor: salvages JD match data even from broken JSON ──
// Returns { match_score, matched_attributes, missing } or null
function extractPartialData(raw) {
  if (!raw) return null;
  const result = {};

  // match_score
  const scoreMatch = raw.match(/"match_score"\s*:\s*(\d+)/);
  if (scoreMatch) result.match_score = parseInt(scoreMatch[1]);

  // candidate_name
  const nameMatch = raw.match(/"candidate_name"\s*:\s*"([^"]{1,80})"/);
  if (nameMatch) result.candidate_name = nameMatch[1];

  // matched_attributes — find each { "attribute": "...", "evidence": "...", "score": N }
  const attrMatches = [...raw.matchAll(
    /"attribute"\s*:\s*"([^"]{1,120})"[^}]*?"evidence"\s*:\s*"([^"]{0,200})"[^}]*?"score"\s*:\s*(\d+)/g
  )];
  if (attrMatches.length) {
    result.matched_attributes = attrMatches.slice(0, 8).map(m => ({
      attribute: m[1].slice(0, 60),
      evidence:  m[2].slice(0, 120),
      score:     Math.min(10, Math.max(1, parseInt(m[3])))
    }));
  }

  // missing — find array items inside "missing":[...]
  const missingBlock = raw.match(/"missing"\s*:\s*\[([^\]]*)\]/s);
  if (missingBlock) {
    result.missing = [...missingBlock[1].matchAll(/"([^"]{1,80})"/g)]
      .map(m => m[1])
      .filter(Boolean)
      .slice(0, 5);
  }

  // strengths / concern / summary
  const strMatch  = raw.match(/"strengths"\s*:\s*"([^"]{1,200})"/);
  const conMatch  = raw.match(/"concern"\s*:\s*"([^"]{0,200})"/);
  const sumMatch  = raw.match(/"summary"\s*:\s*"([^"]{1,300})"/);
  if (strMatch) result.strengths = strMatch[1];
  if (conMatch) result.concern   = conMatch[1];
  if (sumMatch) result.summary   = sumMatch[1];

  return Object.keys(result).length > 0 ? result : null;
}

function buildCVPrompt(jd, cvText, cvName, cvIsBase64, jdIsBase64) {
  const cvSection = cvIsBase64
    ? `CANDIDATE CV (${cvName}): [attached PDF — read the full document carefully]`
    : `CANDIDATE CV (${cvName}):\n${cvText.slice(0, 2800)}`;

  const jdSection = jdIsBase64
    ? `JOB DESCRIPTION: [attached document — read fully]`
    : `JOB DESCRIPTION:\n${jd.slice(0, 1200)}`;

  return `You are a senior HR recruiter scoring a CV against a job description.

OUTPUT ONLY VALID JSON — no markdown, no code fences, no explanation, no text before or after.
Your entire response must be a single JSON object starting with { and ending with }.

Required schema:
{
  "candidate_name": "string",
  "match_score": integer 0-100,
  "matched_attributes": [
    { "attribute": "exact JD requirement", "evidence": "exact quote or detail from CV", "score": integer 1-10 }
  ],
  "missing": ["JD requirement not found in CV"],
  "strengths": "one sentence",
  "concern": "one sentence or empty string",
  "summary": "two sentences: recommendation + next action"
}

RULES:
1. matched_attributes — list EVERY JD requirement that appears in the CV (skills, experience, education, tools, certifications). Max 10. Include exact evidence from the CV.
2. missing — list EVERY JD requirement clearly absent from the CV. Max 6.
3. match_score — derive from matched vs missing. Do NOT default to 50.
4. Scoring: 85-100=exceptional, 70-84=strong, 55-69=moderate, 40-54=weak, <40=poor.

${jdSection}

${cvSection}`;
}

// ── Normalize a parsed or partially-extracted result into the ranked row shape ──
function normalizeResult(data, filename) {
  return {
    filename,
    candidate_name: String(data.candidate_name || 'Unknown Candidate').slice(0, 80),
    match_score: Math.min(100, Math.max(0, Math.round(data.match_score ?? 50))),
    matched_attributes: (data.matched_attributes || [])
      .filter(a => a && a.attribute)
      .slice(0, 10)
      .map(a => ({
        attribute: String(a.attribute).slice(0, 60),
        evidence:  String(a.evidence || '').slice(0, 120),
        score:     Math.min(10, Math.max(1, Math.round(a.score || 5)))
      })),
    missing: (data.missing || [])
      .filter(Boolean)
      .slice(0, 6)
      .map(m => String(m).slice(0, 80)),
    strengths: String(data.strengths || '').slice(0, 200),
    concern:   String(data.concern   || '').slice(0, 200),
    summary:   String(data.summary   || '').slice(0, 300)
  };
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
    const filename = cv.name || 'CV';
    const isPDF    = (cv.mimeType || '').includes('pdf') || filename.endsWith('.pdf');
    const hasBase64 = isPDF && cv.base64 && cv.base64.length > 100;
    const hasText   = cv.text && cv.text.trim().length > 30;

    if (!hasBase64 && !hasText) {
      ranked.push({
        filename,
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
      const prompt = buildCVPrompt(jdText, cv.text || '', filename, hasBase64, hasJDFile);
      const raw = await callGemini(
        prompt,
        hasBase64 ? cv.base64 : null,
        hasBase64 ? 'application/pdf' : null
      );

      // 1️⃣ Try full JSON parse
      let parsed = parseJSON(raw);

      // 2️⃣ If full parse failed, try regex partial extraction
      if (!parsed || typeof parsed.match_score !== 'number') {
        console.warn(`[cv-rank] Full parse failed for ${filename}, attempting partial extraction`);
        parsed = extractPartialData(raw);
      }

      if (parsed && (typeof parsed.match_score === 'number' || parsed.matched_attributes?.length)) {
        ranked.push(normalizeResult(parsed, filename));
      } else {
        // 3️⃣ Last resort — extract at least the score number
        const numMatch = raw.match(/\b(\d{1,3})\b/);
        const score = Math.min(100, Math.max(0, parseInt(numMatch?.[1] || '0')));
        ranked.push({
          filename,
          candidate_name: 'Unknown Candidate',
          match_score: score,
          matched_attributes: [],
          missing: [],
          strengths: 'CV was processed but JD match details could not be extracted.',
          concern: 'Re-upload the CV or try a different file format.',
          summary: 'Manual review recommended. Detailed JD matching unavailable for this candidate.'
        });
      }
    } catch (err) {
      ranked.push({
        filename,
        candidate_name: 'Unknown Candidate',
        match_score: 0,
        matched_attributes: [],
        missing: [],
        strengths: '',
        concern: 'Analysis failed: ' + err.message,
        summary: 'Could not analyze this CV. Try again or contact support.'
      });
    }

    if (cvs.length > 1) await sleep(700);
  }

  ranked.sort((a, b) => b.match_score - a.match_score);
  return res.status(200).json({ ranked });
}
