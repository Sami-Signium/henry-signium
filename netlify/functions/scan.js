// RSS helper
async function fetchRSS(url, label) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PAULBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    const text = await r.text();
    const items = [];
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const item = match[1];
      const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i.exec(item) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(item) || [])[1] || '';
      const desc = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i.exec(item) || /<description[^>]*>([\s\S]*?)<\/description>/i.exec(item) || [])[1] || '';
      const link = (/<link[^>]*>([\s\S]*?)<\/link>/i.exec(item) || [])[1] || '';
      const pubDate = (/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(item) || [])[1] || '';
      // Parse date — supports RFC822, ISO, and Austrian DD.MM.YYYY format
      let articleDate = NaN;
      if (pubDate) {
        articleDate = new Date(pubDate).getTime();
        if (isNaN(articleDate)) {
          // Try Austrian format: DD.MM.YYYY or DD.MM.YYYY, HH:MM:SS
          const m = pubDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
          if (m) articleDate = new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime();
        }
      }
      if (!isNaN(articleDate) && articleDate < cutoff) continue;
      // If no parseable date at all, skip as safety measure
      if (isNaN(articleDate) && !pubDate) {
        const combined = title + ' ' + desc;
        if (/\b(200[0-9]|201[0-9]|202[0-3])\b/.test(combined)) continue;
      }
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

    // === AUSTRIA: Google News RSS + APA-OTS ===
    const austriaFeeds = [
      ['https://news.google.com/rss/search?q=Vorstand+Österreich+Wechsel+when:7d&hl=de&gl=AT&ceid=AT:de', 'GNews AT Vorstand'],
      ['https://news.google.com/rss/search?q=Geschäftsführer+Wien+bestellt+when:7d&hl=de&gl=AT&ceid=AT:de', 'GNews AT GF'],
      ['https://news.google.com/rss/search?q=Übernahme+Fusion+Österreich+Wien+when:7d&hl=de&gl=AT&ceid=AT:de', 'GNews AT M&A'],
      ['https://news.google.com/rss/search?q=CEO+CFO+Aufsichtsrat+Österreich+when:7d&hl=de&gl=AT&ceid=AT:de', 'GNews AT CEO'],
      ['https://news.google.com/rss/search?q=OMV+OR+Verbund+OR+Borealis+OR+Raiffeisen+OR+Erste+Vorstand+when:7d&hl=de&gl=AT&ceid=AT:de', 'GNews AT Unternehmen'],
      ['https://www.ots.at/rss/wirtschaft', 'APA-OTS Wirtschaft'],
      ['https://www.ots.at/rss/personalien', 'APA-OTS Personalien'],
    ];

    // === CEE: Google News RSS + open feeds ===
    const ceeFeeds = [
      ['https://news.google.com/rss/search?q=CEO+appointed+Poland+OR+Romania+OR+Hungary+OR+Czech+when:7d&hl=en&gl=US&ceid=US:en', 'GNews CEE CEO'],
      ['https://news.google.com/rss/search?q=merger+acquisition+Warsaw+OR+Bucharest+OR+Budapest+OR+Prague+when:7d&hl=en&gl=US&ceid=US:en', 'GNews CEE M&A'],
      ['https://emerging-europe.com/feed/', 'Emerging Europe'],
      ['https://bbj.hu/rss', 'Budapest Business Journal'],
      ['https://www.intellinews.com/rss/', 'bne IntelliNews'],
      ['https://business-review.eu/feed', 'Business Review Romania'],
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
