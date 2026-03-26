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

const handler = schedule("0 7 * * *", async () => {
  try {
    const companies = await sbGet("companies?select=id,name");
    if (!companies.length) return { statusCode: 200 };

    // Four parallel news searches: Germany + Austria (broad) + Austria (M&A specific) + CEE
    const [deRes, atRes, atMaRes, ceeRes] = await Promise.all([
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '"Vorstandswechsel" OR "neuer CEO" OR "neuer Vorstand" OR "Vorstandsvorsitzender" OR "Geschäftsführerwechsel" OR "Fusion" OR "Übernahme" OR "Finanzierungsrunde" OR "Restrukturierung"',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(Wien OR Österreich OR Austria OR Vienna) AND (Vorstand OR CEO OR Geschäftsführer OR Übernahme OR Fusion OR Merger OR Akquisition OR Finanzierung)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(Borouge OR Borealis OR OMV OR Verbund OR Erste Group OR Raiffeisen OR Andritz OR Kapsch OR Wienerberger OR Mondi OR Flughafen Wien) AND (CEO OR Vorstand OR Übernahme OR Fusion OR Merger)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 20,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(CEO OR CFO OR executive OR merger OR acquisition OR funding) AND (Poland OR Romania OR Hungary OR Czech OR Slovakia OR Warsaw OR Bucharest OR Budapest OR Prague OR Bratislava)',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      }))
    ]);

    const [deData, atData, atMaData, ceeData] = await Promise.all([deRes.json(), atRes.json(), atMaRes.json(), ceeRes.json()]);

    const allArticles = [
      ...(deData.articles || []),
      ...(atData.articles || []),
      ...(atMaData.articles || []),
      ...(ceeData.articles || [])
    ];

    // Deduplicate by title
    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (!a.title || seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (!unique.length) {
      console.log("PAUL nightly scan: no articles found");
      return { statusCode: 200 };
    }

    // Build article list with URLs for Claude
    const summaries = unique
      .slice(0, 60)
      .map((a, i) => `[${i}] ${a.title}${a.description ? ' | ' + a.description : ''} | URL: ${a.url}`)
      .join('\n');

    // Build article URL lookup map
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

Fokus auf Unternehmen aus DACH (Deutschland, Österreich, Schweiz) und CEE (Polen, Rumänien, Ungarn, Tschechien, Slowakei).

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

    // Load existing triggers from last 7 days to check for duplicates
    const recentTriggers = await sbGet("triggers?select=company_id,trigger_type&created_at=gte." + new Date(Date.now() - 7*24*60*60*1000).toISOString());
    const existingKeys = new Set((recentTriggers || []).map(t => `${t.company_id}__${t.trigger_type}`));

    let found = 0;
    for (const item of items) {
      if (!item.company) continue;

      // Get source URL from article index
      const sourceUrl = (item.article_index !== undefined && articleMap[item.article_index]) ? articleMap[item.article_index] : null;

      // Find or create company
      let comp = companies.find(c =>
        c.name.toLowerCase().includes(item.company.toLowerCase()) ||
        item.company.toLowerCase().includes(c.name.toLowerCase())
      );

      if (!comp) {
        const created = await sbPost("companies", { name: item.company, source: "Auto-Scan" });
        if (created && created[0]) {
          comp = created[0];
          companies.push(comp);
        }
      }

      if (comp) {
        // Duplicate check: same company + same trigger type within last 7 days
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
