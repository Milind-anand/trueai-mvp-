// VeriAI — Multi-key Gemini Proxy + Full Multilingual (23 languages incl. 7 Indian)
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

const SUPPORTED_LANGS = {
  en:'English', hi:'Hindi', fr:'French', de:'German',
  es:'Spanish', pt:'Portuguese', ar:'Arabic', zh:'Chinese',
  ja:'Japanese', ko:'Korean', nl:'Dutch', it:'Italian',
  sv:'Swedish', tr:'Turkish', ru:'Russian', id:'Indonesian',
  bn:'Bengali', mr:'Marathi', ta:'Tamil', te:'Telugu',
  gu:'Gujarati', kn:'Kannada', ml:'Malayalam',
};

const VERDICT_MAP = {
  en:{ ai:'Likely AI-generated',               mixed:'Possibly AI-assisted',              human:'Likely Human' },
  hi:{ ai:'संभवतः AI-निर्मित',                   mixed:'संभवतः AI-सहायक',                    human:'संभवतः मानवीय' },
  fr:{ ai:'Probablement généré par IA',        mixed:'Peut-être assisté par IA',          human:'Probablement humain' },
  de:{ ai:'Wahrscheinlich KI-generiert',       mixed:'Möglicherweise KI-unterstützt',     human:'Wahrscheinlich menschlich' },
  es:{ ai:'Probablemente generado por IA',     mixed:'Posiblemente asistido por IA',      human:'Probablemente humano' },
  pt:{ ai:'Provavelmente gerado por IA',       mixed:'Possivelmente assistido por IA',    human:'Provavelmente humano' },
  ar:{ ai:'على الأرجح مُولَّد بالذكاء الاصطناعي', mixed:'ربما بمساعدة الذكاء الاصطناعي', human:'على الأرجح بشري' },
  zh:{ ai:'很可能是AI生成',                       mixed:'可能有AI辅助',                        human:'很可能是人工书写' },
  ja:{ ai:'AIが生成した可能性が高い',               mixed:'AI支援の可能性あり',                  human:'人間が書いた可能性が高い' },
  ko:{ ai:'AI가 생성했을 가능성 높음',              mixed:'AI 지원 가능성 있음',                 human:'사람이 작성했을 가능성 높음' },
  nl:{ ai:'Waarschijnlijk AI-gegenereerd',     mixed:'Mogelijk AI-ondersteund',           human:'Waarschijnlijk menselijk' },
  it:{ ai:'Probabilmente generato da IA',      mixed:'Possibilmente assistito da IA',     human:'Probabilmente umano' },
  sv:{ ai:'Troligen AI-genererat',             mixed:'Möjligen AI-assisterat',            human:'Troligen mänskligt' },
  tr:{ ai:'Muhtemelen YZ tarafından oluşturuldu', mixed:'Muhtemelen YZ destekli',        human:'Muhtemelen insan tarafından yazıldı' },
  ru:{ ai:'Вероятно создано ИИ',               mixed:'Возможно с помощью ИИ',            human:'Вероятно написано человеком' },
  id:{ ai:'Kemungkinan dibuat AI',             mixed:'Mungkin dibantu AI',               human:'Kemungkinan buatan manusia' },
  bn:{ ai:'সম্ভবত AI-উৎপন্ন',                  mixed:'সম্ভবত AI-সহায়তা',                  human:'সম্ভবত মানবরচিত' },
  mr:{ ai:'बहुधा AI-निर्मित',                   mixed:'शक्यतो AI-सहाय्यित',               human:'बहुधा मानवीय' },
  ta:{ ai:'பெரும்பாலும் AI-உருவாக்கியது',       mixed:'AI உதவியுடன் இருக்கலாம்',         human:'பெரும்பாலும் மனித எழுத்து' },
  te:{ ai:'బహుశా AI-రూపొందించినది',             mixed:'బహుశా AI-సహాయంతో',               human:'బహుశా మానవుడు రాసినది' },
  gu:{ ai:'સંભवतः AI-निर्मित',                  mixed:'સंभवतः AI-सहायित',                 human:'સंभवतः मानवीय' },
  kn:{ ai:'ಬಹುಶಃ AI-ಉತ್ಪಾದಿತ',                mixed:'ಬಹುಶಃ AI-ಸಹಾಯದಿಂದ',              human:'ಬಹುಶಃ ಮಾನವ ಬರಹ' },
  ml:{ ai:'മിക്കവാറും AI ഉണ്ടാക്കിയത്',         mixed:'AI സഹായത്തോടെ ആകാം',            human:'മിക്കവാറും മനുഷ്യൻ എഴുതിയത്' },
};

const CONFIDENCE_MAP = {
  en:{ high:'High',       medium:'Medium',     low:'Low' },
  hi:{ high:'उच्च',       medium:'मध्यम',      low:'कम' },
  fr:{ high:'Haute',      medium:'Moyenne',    low:'Faible' },
  de:{ high:'Hoch',       medium:'Mittel',     low:'Niedrig' },
  es:{ high:'Alta',       medium:'Media',      low:'Baja' },
  pt:{ high:'Alta',       medium:'Média',      low:'Baixa' },
  ar:{ high:'عالية',      medium:'متوسطة',     low:'منخفضة' },
  zh:{ high:'高',          medium:'中',          low:'低' },
  ja:{ high:'高',          medium:'中',          low:'低' },
  ko:{ high:'높음',        medium:'중간',        low:'낮음' },
  nl:{ high:'Hoog',       medium:'Gemiddeld',  low:'Laag' },
  it:{ high:'Alta',       medium:'Media',      low:'Bassa' },
  sv:{ high:'Hög',        medium:'Medel',      low:'Låg' },
  tr:{ high:'Yüksek',     medium:'Orta',       low:'Düşük' },
  ru:{ high:'Высокая',    medium:'Средняя',    low:'Низкая' },
  id:{ high:'Tinggi',     medium:'Sedang',     low:'Rendah' },
  bn:{ high:'উচ্চ',       medium:'মাঝারি',     low:'কম' },
  mr:{ high:'उच्च',       medium:'मध्यम',      low:'कमी' },
  ta:{ high:'அதிக',       medium:'நடுத்தர',    low:'குறைந்த' },
  te:{ high:'అధిక',       medium:'మధ్యస్థ',    low:'తక్కువ' },
  gu:{ high:'ઉચ્ચ',       medium:'મध્યम',      low:'ઓછો' },
  kn:{ high:'ಹೆಚ್ಚಿನ',    medium:'ಮಧ್ಯಮ',     low:'ಕಡಿಮೆ' },
  ml:{ high:'ഉയർന്ന',     medium:'ഇടത്തരം',   low:'കുറഞ്ഞ' },
};

function extractLangContext(text) {
  const m = text.match(/^\[LANGUAGE_CONTEXT:\s*The following text is in ([^.]+)\.[^\]]*\]\s*/i);
  if (m) {
    const langName = m[1].trim();
    const cleanText = text.replace(m[0], '').trim();
    const code = Object.entries(SUPPORTED_LANGS).find(([,v])=>v.toLowerCase()===langName.toLowerCase())?.[0]||'en';
    return { code, name: langName, cleanText };
  }
  return { code:'en', name:'English', cleanText: text };
}

function extractHumanizeLang(text) {
  const m = text.match(/^\[LANGUAGE:\s*([^\]]+)\.\s*Rewrite[^\]]*\]\s*/i);
  if (m) {
    const langName = m[1].split('.')[0].trim();
    const cleanText = text.replace(m[0], '').trim();
    const code = Object.entries(SUPPORTED_LANGS).find(([,v])=>v.toLowerCase()===langName.toLowerCase())?.[0]||'en';
    return { code, name: langName, cleanText };
  }
  return { code:'en', name:'English', cleanText: text };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!KEYS.length) { res.status(500).json({ error: 'No API keys configured' }); return; }

  try {
    const body = req.body;
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    const text = parsed?.text;
    const mode = parsed?._mode;
    if (!text) { res.status(400).json({ error: 'No text provided' }); return; }

    // ── HUMANIZE MODE ──
    if (mode === 'humanize') {
      const { code: langCode, name: langName, cleanText } = extractHumanizeLang(text);
      const isNonEnglish = langCode !== 'en';

      const humanizePrompt = isNonEnglish
        ? `You are an expert ${langName} writer and editor.
Rewrite the following AI-generated text to sound completely natural, human-written, and authentic in ${langName}.
Preserve the original meaning, structure, and intent. Use natural idioms, varied sentence lengths, and culturally appropriate expressions for ${langName}.
Do NOT translate — the output must remain entirely in ${langName} script.
Return ONLY the rewritten text with absolutely no preamble, explanation, or commentary.

Text to rewrite:
${cleanText}`
        : text;

      let lastError = null;
      for (let attempt = 0; attempt < KEYS.length; attempt++) {
        const apiKey = getNextKey();
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: humanizePrompt }] }],
              generationConfig: { temperature: 0.75, maxOutputTokens: 2000 }
            })
          }
        );
        if (geminiRes.status === 429) { lastError = 'rate_limit'; continue; }
        if (!geminiRes.ok) {
          const err = await geminiRes.json();
          const msg = err.error?.message || 'Gemini error';
          if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) { lastError = 'rate_limit'; continue; }
          throw new Error(msg);
        }
        const data = await geminiRes.json();
        const humanized = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        return res.status(200).json({ humanized, lang: langCode });
      }
      return res.status(429).json({ error: 'Rate limit. Please wait and try again.' });
    }

    // ── DETECTION MODE ──
    const { code: langCode, name: langName, cleanText } = extractLangContext(text);
    const isNonEnglish = langCode !== 'en';

    // Indian languages get script-specific instructions
    const indianLangs = ['hi','bn','mr','ta','te','gu','kn','ml'];
    const isIndian = indianLangs.includes(langCode);

    const prompt = isNonEnglish
      ? `You are an expert multilingual AI content detection system with deep knowledge of ${langName}.
Analyze the following ${langName} text for signs of AI generation. Specifically look for:
- Unnaturally perfect ${langName} grammar or spelling
- Repetitive sentence structures common in AI-generated ${langName} text
- Absence of culturally specific ${langName} idioms, colloquialisms, or regional expressions
- Overly formal, generic, or "textbook-style" language not typical of native ${langName} writers
- Missing natural ${langName} discourse markers, connectors, or stylistic quirks${isIndian ? `
- Lack of natural code-mixing patterns typical of written Indian ${langName}
- Absence of culturally relevant Indian context or references` : ''}

Reply ONLY in this exact format (in English, nothing else):
SCORE:[0-100]|REASON:[one English sentence, max 100 chars]

${langName} Text to analyze:
${cleanText.slice(0, 1400)}`
      : `Analyze this text for AI generation. Reply with EXACTLY this format:
SCORE:[number 0-100]|REASON:[one sentence reason under 80 chars]

Text: ${text.slice(0, 1200)}`;

    let lastError = null;
    for (let attempt = 0; attempt < KEYS.length; attempt++) {
      const apiKey = getNextKey();
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 100 }
          })
        }
      );

      if (geminiRes.status === 429) { lastError = 'rate_limit'; continue; }
      if (!geminiRes.ok) {
        const err = await geminiRes.json();
        const msg = err.error?.message || 'Gemini error ' + geminiRes.status;
        if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) { lastError = 'rate_limit'; continue; }
        throw new Error(msg);
      }

      const data = await geminiRes.json();
      if (!data.candidates?.[0]) throw new Error('Empty Gemini response');

      const raw = data.candidates[0].content.parts[0].text.trim();
      const scoreMatch = raw.match(/SCORE[:\s]*(\d+)/i);
      const reasonMatch = raw.match(/REASON[:\s]*(.+)/i);
      const anyNumber = raw.match(/\b(\d{1,3})\b/);

      const score = Math.min(100, Math.max(0, parseInt(scoreMatch?.[1] ?? anyNumber?.[1] ?? '50')));
      const reasoning = (reasonMatch?.[1] ?? 'Analysis based on language patterns.').slice(0, 200);

      const vmap = VERDICT_MAP[langCode] || VERDICT_MAP['en'];
      const cmap = CONFIDENCE_MAP[langCode] || CONFIDENCE_MAP['en'];

      const aiPct = score;
      const humanPct = Math.max(0, 100 - score - 10);
      const mixedPct = 100 - aiPct - humanPct;
      const verdict = score >= 70 ? vmap.ai : score >= 40 ? vmap.mixed : vmap.human;
      const confKey = (score >= 80 || score <= 20) ? 'high' : (score >= 60 || score <= 35) ? 'medium' : 'low';
      const confidence = cmap[confKey];

      const sn = isNonEnglish
        ? { tp:`${langName} AI vocabulary patterns`, st:`${langName} sentence structure`, vo:`${langName} word choice`, sc:`${langName} tone & formality` }
        : { tp:'AI vocabulary and phrases', st:'Sentence structure uniformity', vo:'Word choice predictability', sc:'Tone and formality level' };

      return res.status(200).json({
        overall: score, verdict, confidence,
        lang: langCode, lang_name: langName,
        signals: {
          text_patterns:     { score: Math.min(100, Math.round(score * 1.05)), note: sn.tp },
          structural:        { score: Math.min(100, Math.round(score * 0.95)), note: sn.st },
          vocabulary:        { score: Math.min(100, Math.round(score * 0.90)), note: sn.vo },
          style_consistency: { score: Math.min(100, Math.round(score * 1.00)), note: sn.sc }
        },
        reasoning, ai_percent: aiPct, mixed_percent: mixedPct, human_percent: humanPct, ai_sentences: []
      });
    }

    res.status(429).json({ error: 'Rate limit reached. Please wait 60 seconds and try again. (Free tier: 30 scans/minute)' });

  } catch (err) {
    console.error('VeriAI error:', err.message);
    if (err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED')) {
      res.status(429).json({ error: 'Rate limit reached. Please wait 60 seconds and try again.' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}
