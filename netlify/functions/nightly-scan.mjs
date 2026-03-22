import { schedule } from "@netlify/functions";

const SURL = "https://ftdxhswcnghlmcagrsox.supabase.co";
const SK = "sb_publishable_c8YygosML2xrImmWCpI1rw_6j_pvCRA";
const PK = process.env.PERPLEXITY_API_KEY;

async function sbGet(path) {
  const r = await fetch(SURL+"/rest/v1/"+path, {
    headers: { apikey: SK, Authorization: "Bearer "+SK }
  });
  return r.json();
}

async function sbPost(body) {
  await fetch(SURL+"/rest/v1/triggers", {
    method: "POST",
    headers: { apikey: SK, Authorization: "Bearer "+SK, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body)
  });
}

const handler = schedule("0 3 * * *", async () => {
  const companies = await sbGet("companies?select=id,name");
  if (!companies.length) return { statusCode: 200 };

  let found = 0;

  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer "+PK, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 2000,
        messages: [
          { role: "system", content: "You are a business news analyst. Reply ONLY with a JSON array, no other text." },
          { role: "user", content: "Find 15 real business news from the last 7 days: CEO/CFO/board changes, funding rounds, M&A deals at companies in Germany, Austria, Switzerland, Poland, Romania, Czech Republic, Hungary. Return ONLY JSON array: [{\"company\":\"Name\",\"trigger_type\":\"CEO Change\",\"description\":\"What happened\"}]" }
        ]
      })
    });

    const d = await r.json();
    const txt = d.choices?.[0]?.message?.content || "[]";
    let items = [];
    try { items = JSON.parse(txt.replace(/```json|```/g,"").trim()); } catch(e) {}

    for (const item of items) {
      if (!item.company) continue;
      const comp = companies.find(c =>
        c.name.toLowerCase().includes(item.company.toLowerCase()) ||
        item.company.toLowerCase().includes(c.name.toLowerCase())
      );
      if (comp) {
        await sbPost({
          company_id: comp.id,
          trigger_type: item.trigger_type || "Sonstige",
          description: item.description || "",
          relevance_score: 80
        });
        found++;
      }
    }
  } catch(e) {
    console.error("HENRY nightly scan error:", e.message);
  }

  console.log("HENRY nightly scan done. Matches found: "+found);
  return { statusCode: 200, body: JSON.stringify({ found }) };
});

export { handler };
