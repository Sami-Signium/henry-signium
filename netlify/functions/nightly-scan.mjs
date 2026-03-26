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

    // === AUSTRIA: broad leadership + M&A keywords, Austrian sources ===
    const [atMgmtRes, atMaRes, atSpecRes] = await Promise.all([

      // Austria: Management changes
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(Vorstand OR Geschäftsführer OR CEO OR CFO OR CHRO OR Aufsichtsrat) AND (Wien OR Österreich OR Austria)',
        sources: 'der-standard,die-presse',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 25,
        apiKey: NEWS_API_KEY
      })),

      // Austria: M&A + Funding from Austrian business media
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(Übernahme OR Fusion OR Merger OR Akquisition OR Finanzierungsrunde OR Restrukturierung) AND (Wien OR Österreich)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 25,
        apiKey: NEWS_API_KEY
      })),

      // Austria: Named major Austrian companies (direct monitoring)
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(OMV OR Borealis OR Borouge OR Verbund OR "Erste Group" OR Raiffeisen OR Andritz OR Kapsch OR Wienerberger OR Mondi OR "Flughafen Wien" OR Spar OR Rewe OR "Vienna Insurance" OR Uniqa OR "Österreichische Post" OR Telekom OR "A1 Telekom") AND (Vorstand OR CEO OR Übernahme OR Fusion OR Aufsichtsrat)',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 20,
        apiKey: NEWS_API_KEY
      }))
    ]);

    // === CEE: English + local language coverage ===
    const [ceeEngRes, ceePlRes, ceeCzHuRes] = await Promise.all([

      // CEE English: Emerging Europe, BBJ, intellinews, Business Review
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(CEO OR CFO OR "executive appointment" OR merger OR acquisition OR funding) AND (Poland OR Romania OR Hungary OR "Czech Republic" OR Slovakia OR Warsaw OR Bucharest OR Budapest OR Prague OR Bratislava)',
        sources: 'the-economist',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 20,
        apiKey: NEWS_API_KEY
      })),

      // CEE English broad (no source filter)
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '("executive appointment" OR "new CEO" OR "new CFO" OR "board appointment" OR merger OR acquisition) AND (Warsaw OR Bucharest OR Budapest OR Prague OR Bratislava OR "Central Europe" OR "Eastern Europe")',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 25,
        apiKey: NEWS_API_KEY
      })),

      // CEE local language (Polish/Czech/Slovak/Hungarian/Romanian keywords)
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(prezes OR dyrektor OR fuzja OR przejecie) OR (generalni OR predstavenstvo OR fúzia) OR (vezérigazgató OR igazgató OR felvásárlás) OR (director OR numire OR fuziune OR achizitie)',
        sortBy: 'publishedAt',
        pageSize: 20,
        apiKey: NEWS_API_KEY
      }))
    ]);

    // === GERMANY: reduced to essentials only ===
    const deRes = await fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
      q: '"Vorstandswechsel" OR "neuer Vorstandsvorsitzender" OR "neuer CEO" OR "Übernahme abgeschlossen" OR "Fusion abgeschlossen"',
      sources: 'handelsblatt,manager-magazin',
      language: 'de',
      sortBy: 'publishedAt',
      pageSize: 15,
      apiKey: NEWS_API_KEY
    }));

    const allResponses = await Promise.all([
      atMgmtRes.json(), atMaRes.json(), atSpecRes.json(),
      ceeEngRes.json(), ceePlRes.json(), ceeCzHuRes.json(),
      deRes.json()
    ]);

    const allArticles = allResponses.flatMap(d => d.articles || []);

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

    // Build article list with index and URL for Claude
    const summaries = unique
      .slice(0, 60)
      .map((a, i) => `[${i}] ${a.title}${a.description ? ' | ' + a.description : ''} | URL: ${a.url}`)
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

Fokus auf Unternehmen aus Österreich und CEE (Polen, Rumänien, Ungarn, Tschechien, Slowakei). Deutschland ist weniger wichtig.

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
