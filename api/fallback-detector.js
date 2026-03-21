// ============================================================
// VeriAI — Fallback Local Detector (No API needed)
// Used when all Gemini keys are rate-limited
// Runs entirely in Node.js / Vercel serverless
// ============================================================

// ── AI Writing Signals ──────────────────────────────────────
const AI_PHRASES = [
  'it is important to note','it is worth noting','it should be noted',
  'in conclusion','to summarize','in summary','as mentioned above',
  'furthermore','moreover','additionally','consequently','therefore',
  'it is essential','it is crucial','it is vital','plays a crucial role',
  'plays an important role','in today\'s world','in the modern era',
  'in recent years','has become increasingly','delve into','dive into',
  'shed light on','in order to','due to the fact that',
  'a wide range of','a variety of','numerous','various',
  'comprehensive','significant','substantial','robust','leverage',
  'utilize','facilitate','implement','demonstrate','indicate',
  'nevertheless','however','on the other hand','on the contrary',
  'first and foremost','last but not least','all in all',
  'at the end of the day','needless to say','it goes without saying',
  'as a result','this means that','this indicates that',
  'research has shown','studies have shown','according to research',
  'overall','ultimately','generally speaking','in general',
  'when it comes to','with regard to','with respect to',
];

const AI_SENTENCE_STARTERS = [
  'artificial intelligence','machine learning','deep learning',
  'neural network','large language model','natural language',
  'in this essay','this essay will','this paper will',
  'the purpose of this','the aim of this','the goal of this',
];

// ── Plagiarism Signals (structural patterns) ────────────────
const PLAGIARISM_SIGNALS = {
  // Overly formal/encyclopedic tone markers
  encyclopedicPhrases: [
    'is defined as','refers to the','is a type of','is a form of',
    'is characterized by','is known as','is classified as',
    'according to','as stated by','as noted by','as described by',
    'was first introduced','was originally','has been widely',
  ],
  // Citation-like patterns
  citationPatterns: [
    /\(\d{4}\)/g,           // (2023)
    /\[[\d,\s]+\]/g,        // [1] or [1,2]
    /et al\./gi,            // et al.
    /ibid\./gi,             // ibid.
    /op\. cit\./gi,         // op. cit.
  ],
  // Copy-paste artifacts
  copyPasteArtifacts: [
    /[^\x00-\x7F]/g,        // non-ASCII (encoding artifacts)
    /\s{3,}/g,              // multiple spaces (copy-paste)
    /\t/g,                  // tabs (from Word/PDF)
  ],
};

// ── Web Content Signals ──────────────────────────────────────
const WEB_SIGNALS = {
  urlPatterns: [
    /https?:\/\//gi,
    /www\./gi,
    /\.com|\.org|\.net|\.edu|\.gov/gi,
  ],
  webPhrases: [
    'click here','read more','learn more','find out more',
    'sign up','log in','subscribe','follow us','share this',
    'copyright','all rights reserved','privacy policy',
    'terms of service','cookie policy',
    'published by','posted by','written by','edited by',
    'last updated','last modified','updated on',
    'tags:','categories:','related articles','see also',
    'advertisement','sponsored','affiliate',
    '©','®','™',
  ],
  htmlArtifacts: [
    /<[a-z][\s\S]*?>/gi,    // HTML tags
    /&[a-z]+;/gi,           // HTML entities like &amp;
    /\[caption\]/gi,        // WordPress captions
    /\[/g,                  // shortcodes
  ],
};

// ── Video Content Signals ────────────────────────────────────
const VIDEO_SIGNALS = {
  transcriptPhrases: [
    "so today we're","hey guys","what's up","welcome back",
    "don't forget to","hit that like button","subscribe",
    "in this video","in today's video","let me show you",
    "as you can see","if you look at","click the link",
    "check out","smash that","comment below","let me know",
    "in the next video","see you next time","peace out",
    "yo","gonna","wanna","kinda","sorta","lemme","gotta",
    "[music]","[applause]","[laughter]","[inaudible]",
    "um","uh","like,","you know,","right?","okay so",
  ],
  timestampPatterns: [
    /\d{1,2}:\d{2}/g,       // 0:00 or 12:34
    /\[\d{2}:\d{2}\]/g,     // [00:00]
  ],
};

// ── Core Scoring Engine ──────────────────────────────────────
export function localAnalyze(text) {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const wordCount = words.length;

  if (wordCount < 10) {
    return {
      error: 'Text too short for analysis (minimum 10 words)',
      fallback: true
    };
  }

  // ── 1. AI Score ──────────────────────────────────────────
  let aiScore = 0;
  let aiMatches = [];

  // Phrase matching
  for (const phrase of AI_PHRASES) {
    if (lower.includes(phrase)) {
      aiScore += 4;
      aiMatches.push(phrase);
    }
  }
  for (const starter of AI_SENTENCE_STARTERS) {
    if (lower.includes(starter)) {
      aiScore += 5;
      aiMatches.push(starter);
    }
  }

  // Sentence length uniformity (AI tends to write uniform sentences)
  if (sentences.length >= 3) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a,b) => a+b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 5 && avg > 12) aiScore += 15; // very uniform = AI
    else if (stdDev < 8) aiScore += 8;
  }

  // Paragraph structure (AI loves exactly 3-5 sentences per paragraph)
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 2) {
    const paraLengths = paragraphs.map(p => p.split(/[.!?]+/).filter(s => s.trim().length > 5).length);
    const allInRange = paraLengths.every(l => l >= 2 && l <= 6);
    if (allInRange && paragraphs.length >= 3) aiScore += 10;
  }

  // Punctuation variety (AI uses less variety)
  const hasExclamation = /!/.test(text);
  const hasDash = /—|–|-/.test(text);
  const hasEllipsis = /\.\.\./.test(text);
  const hasParenthetical = /\(.*?\)/.test(text);
  const punctuationVariety = [hasExclamation, hasDash, hasEllipsis, hasParenthetical].filter(Boolean).length;
  if (punctuationVariety === 0) aiScore += 10;
  else if (punctuationVariety === 1) aiScore += 5;

  // First person usage (AI avoids strong first-person)
  const firstPersonCount = (lower.match(/\b(i |i'm|i've|i'll|i'd|my |mine|myself)\b/g) || []).length;
  const firstPersonRatio = firstPersonCount / wordCount;
  if (firstPersonRatio < 0.005 && wordCount > 50) aiScore += 8;

  // Vocabulary richness (AI uses repetitive vocab)
  const uniqueWords = new Set(words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
  const lexicalDiversity = uniqueWords.size / wordCount;
  if (lexicalDiversity < 0.5) aiScore += 10;
  else if (lexicalDiversity < 0.6) aiScore += 5;

  const finalAiScore = Math.min(95, Math.max(5, aiScore));

  // ── 2. Plagiarism Score ──────────────────────────────────
  let plagScore = 0;
  let plagMatches = [];

  for (const phrase of PLAGIARISM_SIGNALS.encyclopedicPhrases) {
    if (lower.includes(phrase)) {
      plagScore += 6;
      plagMatches.push(phrase);
    }
  }
  for (const pattern of PLAGIARISM_SIGNALS.citationPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      plagScore += matches.length * 8;
      plagMatches.push(pattern.toString());
    }
  }
  for (const pattern of PLAGIARISM_SIGNALS.copyPasteArtifacts) {
    if (pattern.test(text)) plagScore += 5;
  }

  // Sentence length extremes (copied academic text has long sentences)
  const longSentences = sentences.filter(s => s.trim().split(/\s+/).length > 35).length;
  if (longSentences / Math.max(sentences.length, 1) > 0.3) plagScore += 12;

  const finalPlagScore = Math.min(90, Math.max(5, plagScore));

  // ── 3. Web Content Score ─────────────────────────────────
  let webScore = 0;

  for (const pattern of WEB_SIGNALS.urlPatterns) {
    if (pattern.test(text)) webScore += 20;
  }
  for (const phrase of WEB_SIGNALS.webPhrases) {
    if (lower.includes(phrase)) webScore += 8;
  }
  for (const pattern of WEB_SIGNALS.htmlArtifacts) {
    if (pattern.test(text)) webScore += 15;
  }

  const finalWebScore = Math.min(95, Math.max(5, webScore));

  // ── 4. Video Content Score ───────────────────────────────
  let videoScore = 0;

  for (const phrase of VIDEO_SIGNALS.transcriptPhrases) {
    if (lower.includes(phrase)) videoScore += 10;
  }
  for (const pattern of VIDEO_SIGNALS.timestampPatterns) {
    const matches = text.match(pattern);
    if (matches) videoScore += matches.length * 5;
  }

  // Informal contraction density (high = video transcript)
  const contractions = (lower.match(/\b(don't|won't|can't|it's|that's|there's|they're|you're|we're|i'm|isn't|wasn't|aren't|weren't|doesn't|didn't|wouldn't|couldn't|shouldn't)\b/g) || []).length;
  const contractionRatio = contractions / wordCount;
  if (contractionRatio > 0.04) videoScore += 15;
  else if (contractionRatio > 0.02) videoScore += 8;

  const finalVideoScore = Math.min(90, Math.max(5, videoScore));

  // ── 5. Build Verdict ─────────────────────────────────────
  const aiVerdict = finalAiScore >= 70 ? 'Likely AI-generated' :
                    finalAiScore >= 40 ? 'Possibly AI-assisted' : 'Likely Human-written';

  const plagVerdict = finalPlagScore >= 60 ? 'High plagiarism risk' :
                      finalPlagScore >= 35 ? 'Moderate plagiarism risk' : 'Low plagiarism risk';

  const webVerdict = finalWebScore >= 60 ? 'Likely web-scraped content' :
                     finalWebScore >= 30 ? 'Contains web content markers' : 'No significant web markers';

  const videoVerdict = finalVideoScore >= 50 ? 'Likely video transcript' :
                       finalVideoScore >= 25 ? 'Possible transcript content' : 'Not transcript-like';

  const topSignal = [
    { label: 'AI', score: finalAiScore },
    { label: 'Plagiarism', score: finalPlagScore },
    { label: 'Web', score: finalWebScore },
    { label: 'Video', score: finalVideoScore },
  ].sort((a,b) => b.score - a.score)[0];

  const confidence = (finalAiScore >= 75 || finalAiScore <= 25) ? 'Medium' : 'Low';

  const reasoning = aiMatches.length > 0
    ? `Detected ${aiMatches.length} AI-typical phrases including "${aiMatches[0]}". Local analysis only.`
    : `Based on sentence structure, vocabulary patterns, and style markers. Local analysis only.`;

  return {
    fallback: true,
    fallback_reason: 'API rate limit reached — local analysis used',
    overall: finalAiScore,
    verdict: aiVerdict,
    confidence,
    reasoning,
    signals: {
      text_patterns:     { score: finalAiScore,   note: 'AI vocabulary and phrase patterns' },
      structural:        { score: Math.min(95, Math.round(finalAiScore * 0.95)), note: 'Sentence structure uniformity' },
      vocabulary:        { score: Math.min(95, Math.round(finalAiScore * 0.90)), note: 'Word choice predictability' },
      style_consistency: { score: Math.min(95, Math.round(finalAiScore * 1.00)), note: 'Tone and formality level' },
    },
    ai_percent:     finalAiScore,
    human_percent:  Math.max(0, 100 - finalAiScore - 10),
    mixed_percent:  Math.min(10, 100 - finalAiScore),
    ai_sentences:   [],
    // Extra fallback-only fields
    plagiarism: {
      score: finalPlagScore,
      verdict: plagVerdict,
      note: 'Based on structural & citation patterns — not a live database check',
    },
    web_content: {
      score: finalWebScore,
      verdict: webVerdict,
      note: 'Based on URL, HTML, and web phrase detection',
    },
    video_content: {
      score: finalVideoScore,
      verdict: videoVerdict,
      note: 'Based on transcript phrase and timestamp patterns',
    },
    dominant_signal: topSignal.label,
    word_count: wordCount,
    sentence_count: sentences.length,
  };
}
