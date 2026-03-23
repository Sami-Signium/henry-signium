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

    // Three parallel news searches: Germany + Austria + CEE
    const [deRes, atRes, ceeRes] = await Promise.all([
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '"Vorstandswechsel" OR "neuer CEO" OR "neuer Vorstand" OR "Vorstandsvorsitzender" OR "Geschäftsführerwechsel" OR "Fusion abgeschlossen" OR "Übernahme abgeschlossen" OR "Finanzierungsrunde"',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'Wien Vorstand OR Österreich CEO OR Österreich Übernahme OR Wien Geschäftsführer OR Austria merger OR Vienna acquisition',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(CEO OR CFO OR executive OR merger OR acquisition OR funding) AND (Poland OR Romania OR Hungary OR Prague OR Warsaw OR Bucharest OR Budapest)',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      }))
    ]);

    const [deData, atData, ceeData] = await Promise.all([deRes.json(), atRes.json(), ceeRes.json()]);

    const allArticles = [
      ...(deData.articles || []),
      ...(atData.articles || []),
      ...(ceeData.articles || [])
    ];

    // Deduplicate
    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (!unique.length) {
      console.log("PAUL nightly scan: no articles found");
      return { statusCode: 200 };
    }

    const summaries = unique
      .slice(0, 50)
      .map(a => `- ${a.title}${a.description ? ' | ' + a.description : ''}`)
      .join('\n');

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
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `Extrahiere Business-Ereignisse aus diesen Nachrichten. Nur: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A, Funding, Restrukturierungen. Fokus auf DACH und CEE Unternehmen.

Antworte NUR mit JSON-Array (kein anderer Text):
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Was passiert ist"}]

Nachrichten:
${summaries}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();

    let items = [];
    try { items = JSON.parse(clean); } catch(e) {}

    let found = 0;
    for (const item of items) {
      if (!item.company) continue;

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
        await sbPost("triggers", {
          company_id: comp.id,
          trigger_type: item.trigger_type || "Sonstige",
          description: item.description || "",
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
