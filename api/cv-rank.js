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

function parseJSON(raw) {
  try {
    return JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch {
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { return null; } }
    return null;
  }
}

function buildCVPrompt(jd, cvText, cvName) {
  return `You are a senior HR recruiter and talent assessment expert. Your job is to objectively score this candidate's CV against the job description.

Return ONLY a valid JSON object — no markdown, no explanation, just raw JSON:

{
  "candidate_name": "<full name from the CV, or 'Unknown Candidate' if not clearly stated>",
  "match_score": <integer 0-100: how well this CV matches the JD overall. Be honest: 90+ = exceptional fit, 70-89 = strong fit, 50-69 = moderate fit, 30-49 = weak fit, <30 = poor fit>,
  "matched_attributes": [
    {
      "attribute": "<specific skill, qualification or requirement from the JD>",
      "evidence": "<exact quote or paraphrase from the CV proving this, max 25 words>",
      "score": <integer 1-10: quality of this specific match>
    }
  ],
  "missing": [
    "<important JD requirement that is clearly NOT present in the CV>"
  ],
  "strengths": "<one clear sentence: the single most compelling reason to shortlist this candidate>",
  "concern": "<one clear sentence: the biggest gap or risk, or empty string if no significant concern>",
  "summary": "<2 sentences: overall hiring recommendation and next suggested action>"
}

Rules for scoring:
- matched_attributes: list ALL JD requirements that have any evidence in CV (max 8)
- missing: list ONLY requirements clearly absent from CV (max 5, be precise)
- match_score of 50 = genuine average fit, not charitable rounding up
- Use specific evidence quotes, not generic statements like "has experience"
- If CV is very short or lacks detail, note this in the concern field

JOB DESCRIPTION:
${jd.slice(0, 1200)}

CANDIDATE CV (${cvName}):
${cvText.slice(0, 2800)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const { jd, cvs } = req.body || {};

  if (!jd || typeof jd !== 'string' || jd.trim().length < 30) {
    return res.status(400).json({ error: 'Job description is required (minimum 30 characters)' });
  }
  if (!cvs || !Array.isArray(cvs) || !cvs.length) {
    return res.status(400).json({ error: 'At least one CV is required' });
  }
  if (!KEYS.length) {
    return res.status(500).json({ error: 'No API keys configured. Add GEMINI_KEY to Vercel environment variables.' });
  }

  const ranked = [];

  for (const cv of cvs.slice(0, 5)) { // max 5 CVs
    if (!cv.text || cv.text.trim().length < 30) {
      ranked.push({
        filename: cv.name || 'Unknown CV',
        candidate_name: 'Unknown Candidate',
        match_score: 0,
        matched_attributes: [],
        missing: ['Could not extract CV text — file may be image-based or corrupted'],
        strengths: '',
        concern: 'CV could not be read. Ask candidate to submit as plain text or copy-paste.',
        summary: 'Unable to analyze this CV due to extraction failure.'
      });
      continue;
    }

    try {
      const prompt = buildCVPrompt(jd.trim(), cv.text, cv.name || 'CV');
      const raw = await callGemini(prompt);
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
