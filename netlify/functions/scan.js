// RSS helper
async function fetchRSS(url, label) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAULBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    const text = await r.text();
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const item = match[1];
      const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(item) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(item) || [])[1] || '';
      const desc = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i.exec(item) || /<description[^>]*>([\s\S]*?)<\/description>/i.exec(item) || [])[1] || '';
      const link = (/<link[^>]*>([\s\S]*?)<\/link>/i.exec(item) || [])[1] || '';
      if (title.trim()) {
        items.push({
          title: title.replace(/<[^>]+>/g, '').trim(),
          description: desc.replace(/<[^>]+>/g, '').substring(0, 200).trim(),
          url: link.trim(),
          source: label
        });
      }
    }
    return items;
  } catch(e) {
    console.log(`RSS ${label} failed: ${e.message}`);
    return [];
  }
}

const TRIGGER_KEYWORDS = [
  'vorstand','geschäftsführer','ceo','cfo','chro','aufsichtsrat',
  'übernahme','fusion','merger','akquisition','acquisition',
  'finanzierungsrunde','funding','restrukturierung','stellenabbau',
  'appointed','appointment','new ceo','new cfo','executive',
  'wechsel','bestellung','ernennung','rücktritt','abgang',
  'prezes','dyrektor','fuzja','przejęcie',
  'vezérigazgató','felvásárlás',
  'director general','numire','fuziune'
];

function isRelevant(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return TRIGGER_KEYWORDS.some(kw => text.includes(kw));
}

export default async function handler(req, context) {
  if (req.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    const NEWS_API_KEY = '4bc455fcb3de4648a707d4b3cd96a091';

    // === AUSTRIA RSS ===
    const austriaFeeds = [
      ['https://www.derstandard.at/rss/wirtschaft', 'Der Standard'],
      ['https://www.diepresse.com/rss/wirtschaft', 'Die Presse'],
      ['https://kurier.at/wirtschaft/rss', 'Kurier'],
      ['https://www.trend.at/rss/wirtschaft', 'Trend'],
      ['https://www.industriemagazin.at/rss', 'Industriemagazin'],
      ['https://www.ots.at/rss/wirtschaft', 'APA-OTS'],
    ];

    // === CEE RSS ===
    const ceeFeeds = [
      ['https://emerging-europe.com/feed/', 'Emerging Europe'],
      ['https://bbj.hu/rss', 'Budapest Business Journal'],
      ['https://www.intellinews.com/rss/', 'bne IntelliNews'],
      ['https://business-review.eu/feed', 'Business Review Romania'],
      ['https://www.hn.cz/rss/ekonomika', 'Hospodářské noviny'],
    ];

    // Fetch all RSS in parallel
    const rssResults = await Promise.all([
      ...austriaFeeds.map(([url, label]) => fetchRSS(url, label)),
      ...ceeFeeds.map(([url, label]) => fetchRSS(url, label))
    ]);

    const rssArticles = rssResults.flat().filter(a => isRelevant(a.title, a.description));

    // === GERMANY: NewsAPI minimal ===
    let deArticles = [];
    try {
      const deRes = await fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '("Vorstandswechsel" OR "neuer Vorstandsvorsitzender" OR "Übernahme abgeschlossen" OR "Fusion abgeschlossen") AND (DAX OR MDAX)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 15,
        apiKey: NEWS_API_KEY
      }));
      const deData = await deRes.json();
      deArticles = (deData.articles || []).map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: 'NewsAPI DE'
      }));
    } catch(e) {}

    const allArticles = [...rssArticles, ...deArticles];

    // Deduplicate
    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (!a.title || seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (!unique.length) {
      return new Response(JSON.stringify({ text: '[]' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Build summaries with index for URL mapping
    const summaries = unique
      .slice(0, 60)
      .map((a, i) => `[${i}] [${a.source}] ${a.title}${a.description ? ' | ' + a.description : ''} | URL: ${a.url}`)
      .join('\n');

    const articleMap = {};
    unique.slice(0, 60).forEach((a, i) => { articleMap[i] = a.url; });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Extrahiere Business-Ereignisse aus diesen Nachrichten. Relevante Ereignisse:
- Vorstandswechsel, CEO-Wechsel, CFO-Wechsel, CHRO-Wechsel, Geschäftsführer-Wechsel
- Aufsichtsrat-Bestellung oder Aufsichtsrat-Rücktritt
- M&A / Fusion (Fusionen, Übernahmen, Merger, Akquisitionen)
- Funding / Finanzierungsrunde
- Restrukturierung
- DACH-Expansion

Priorität: Österreich und CEE (Polen, Rumänien, Ungarn, Tschechien, Slowakei).

WICHTIG für trigger_type - verwende EXAKT einen dieser Werte:
"CEO-Wechsel", "CFO-Wechsel", "CHRO-Wechsel", "Geschäftsführer-Wechsel", "Neuer Vorstand", "Aufsichtsrat-Bestellung", "Aufsichtsrat-Rücktritt", "M&A / Fusion", "Funding", "Restrukturierung", "DACH-Expansion", "Sonstige"

Antworte NUR mit JSON-Array (kein anderer Text):
[{"article_index": 0, "company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Konkrete Beschreibung"}]

Nachrichten:
${summaries}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
    const s = raw.indexOf('['), e = raw.lastIndexOf(']');
    let items = [];
    try { if (s >= 0 && e > s) items = JSON.parse(raw.substring(s, e + 1)); } catch(err) {}

    // Inject source_url from articleMap
    items = items.map(it => ({
      ...it,
      source_url: (it.article_index !== undefined && articleMap[it.article_index]) ? articleMap[it.article_index] : null
    }));

    return new Response(JSON.stringify({ text: JSON.stringify(items), articleCount: unique.length }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export const config = { path: '/api/scan' };
