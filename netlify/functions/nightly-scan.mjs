import { schedule } from "@netlify/functions";

const SURL = "https://ftdxhswcnghlmcagrsox.supabase.co";
const SK = "sb_publishable_c8YygosML2xrImmWCpI1rw_6j_pvCRA";
const NEWS_API_KEY = "4bc455fcb3de4648a707d4b3cd96a091";

async function sbGet(path) {
  const r = await fetch(SURL + "/rest/v1/" + path, {
    headers: { apikey: SK, Authorization: "Bearer " + SK }
  });
  return r.json();
}

async function sbPost(table, body) {
  const r = await fetch(SURL + "/rest/v1/" + table, {
    method: "POST",
    headers: { apikey: SK, Authorization: "Bearer " + SK, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  return r.json();
}

// Parse RSS feed and return articles
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
    console.log(`RSS ${label}: ${items.length} items`);
    return items;
  } catch(e) {
    console.log(`RSS ${label} failed: ${e.message}`);
    return [];
  }
}

// Keywords that indicate relevant trigger events
const TRIGGER_KEYWORDS = [
  'vorstand', 'geschäftsführer', 'ceo', 'cfo', 'chro', 'aufsichtsrat',
  'übernahme', 'fusion', 'merger', 'akquisition', 'acquisition',
  'finanzierungsrunde', 'funding', 'restrukturierung', 'stellenabbau',
  'appointed', 'appointment', 'new ceo', 'new cfo', 'executive',
  'prezes', 'dyrektor', 'fuzja', 'przejęcie',
  'generální ředitel', 'fúze', 'akvizice',
  'vezérigazgató', 'felvásárlás',
  'director general', 'numire', 'fuziune',
  'wechsel', 'bestellung', 'ernennung', 'rücktritt', 'abgang'
];

function isRelevant(title, desc) {
  const text = (title + ' ' + desc).toLowerCase();
  return TRIGGER_KEYWORDS.some(kw => text.includes(kw));
}

const handler = schedule("0 7 * * *", async () => {
  try {
    const companies = await sbGet("companies?select=id,name");
    if (!companies.length) return { statusCode: 200 };

    // === AUSTRIA RSS FEEDS ===
    const austriaFeeds = [
      ['https://www.derstandard.at/rss/wirtschaft', 'Der Standard Wirtschaft'],
      ['https://www.diepresse.com/rss/wirtschaft', 'Die Presse Wirtschaft'],
      ['https://kurier.at/wirtschaft/rss', 'Kurier Wirtschaft'],
      ['https://www.trend.at/rss/wirtschaft', 'Trend'],
      ['https://www.industriemagazin.at/rss', 'Industriemagazin'],
      ['https://www.medianet.at/rss', 'Medianet'],
      ['https://www.ots.at/rss/wirtschaft', 'APA-OTS Wirtschaft'],
    ];

    // === CEE RSS FEEDS (English) ===
    const ceeFeeds = [
      ['https://emerging-europe.com/feed/', 'Emerging Europe'],
      ['https://bbj.hu/rss', 'Budapest Business Journal'],
      ['https://www.intellinews.com/rss/', 'bne IntelliNews'],
      ['https://business-review.eu/feed', 'Business Review Romania'],
      ['https://www.rp.pl/rss/1019', 'Rzeczpospolita'],
      ['https://www.hn.cz/rss/ekonomika', 'Hospodářské noviny'],
    ];

    // Fetch all RSS feeds in parallel
    const allFeedResults = await Promise.all([
      ...austriaFeeds.map(([url, label]) => fetchRSS(url, label)),
      ...ceeFeeds.map(([url, label]) => fetchRSS(url, label))
    ]);

    const rssArticles = allFeedResults.flat().filter(a => isRelevant(a.title, a.description));
    console.log(`RSS relevant articles after filter: ${rssArticles.length}`);

    // === GERMANY: NewsAPI (minimal) ===
    let newsApiArticles = [];
    try {
      const deRes = await fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '("Vorstandswechsel" OR "neuer Vorstandsvorsitzender" OR "Übernahme abgeschlossen" OR "Fusion abgeschlossen") AND (DAX OR MDAX)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 15,
        apiKey: NEWS_API_KEY
      }));
      const deData = await deRes.json();
      newsApiArticles = (deData.articles || []).map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: 'NewsAPI DE'
      }));
    } catch(e) {
      console.log('NewsAPI DE failed:', e.message);
    }

    const allArticles = [...rssArticles, ...newsApiArticles];

    // Deduplicate by title
    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (!a.title || seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (!unique.length) {
      console.log("PAUL nightly scan: no relevant articles found");
      return { statusCode: 200 };
    }

    console.log(`Total unique relevant articles: ${unique.length}`);

    // Build article list with index and URL for Claude
    const summaries = unique
      .slice(0, 60)
      .map((a, i) => `[${i}] [${a.source}] ${a.title}${a.description ? ' | ' + a.description : ''} | URL: ${a.url}`)
      .join('\n');

    const articleMap = {};
    unique.slice(0, 60).forEach((a, i) => { articleMap[i] = a.url; });

    // Claude extracts trigger events
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
- M&A / Fusion (Fusionen, Übernahmen, Merger, Akquisitionen, Zusammenschlüsse)
- Funding / Finanzierungsrunde
- Restrukturierung, Stellenabbau
- DACH-Expansion

Priorität: Österreich und CEE (Polen, Rumänien, Ungarn, Tschechien, Slowakei). Deutschland nur wenn sehr relevant.

WICHTIG für trigger_type - verwende EXAKT einen dieser Werte:
"CEO-Wechsel", "CFO-Wechsel", "CHRO-Wechsel", "Geschäftsführer-Wechsel", "Neuer Vorstand", "Aufsichtsrat-Bestellung", "Aufsichtsrat-Rücktritt", "M&A / Fusion", "Funding", "Restrukturierung", "DACH-Expansion", "Sonstige"

Antworte NUR mit JSON-Array (kein anderer Text, keine Erklärungen):
[{"article_index": 0, "company":"Firmenname","trigger_type":"M&A / Fusion","description":"Konkrete Beschreibung was passiert ist"}]

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

    // Duplicate check: last 7 days
    const recentTriggers = await sbGet("triggers?select=company_id,trigger_type&created_at=gte." + new Date(Date.now() - 7*24*60*60*1000).toISOString());
    const existingKeys = new Set((recentTriggers || []).map(t => `${t.company_id}__${t.trigger_type}`));

    let found = 0;
    for (const item of items) {
      if (!item.company) continue;

      const sourceUrl = (item.article_index !== undefined && articleMap[item.article_index]) ? articleMap[item.article_index] : null;

      let comp = companies.find(c =>
        c.name.toLowerCase().includes(item.company.toLowerCase()) ||
        item.company.toLowerCase().includes(c.name.toLowerCase())
      );

      if (!comp) {
        const created = await sbPost("companies", { name: item.company, source: "Auto-Scan" });
        if (created && created[0]) { comp = created[0]; companies.push(comp); }
      }

      if (comp) {
        const key = `${comp.id}__${item.trigger_type}`;
        if (existingKeys.has(key)) {
          console.log(`Skipping duplicate: ${item.company} / ${item.trigger_type}`);
          continue;
        }
        existingKeys.add(key);

        await sbPost("triggers", {
          company_id: comp.id,
          trigger_type: item.trigger_type || "Sonstige",
          description: item.description || "",
          source_url: sourceUrl,
          relevance_score: 80
        });
        found++;
      }
    }

    console.log(`PAUL morning scan done. Articles: ${unique.length}, Triggers saved: ${found}`);
    return { statusCode: 200, body: JSON.stringify({ found }) };

  } catch(e) {
    console.error("PAUL nightly scan error:", e.message);
    return { statusCode: 200 };
  }
});

export { handler };
