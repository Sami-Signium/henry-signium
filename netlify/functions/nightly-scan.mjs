import { schedule } from "@netlify/functions";

const SURL = "https://ftdxhswcnghlmcagrsox.supabase.co";
const SK = "sb_publishable_c8YygosML2xrImmWCpI1rw_6j_pvCRA";

async function sbGet(path) {
  const r = await fetch(SURL+"/rest/v1/"+path, {
    headers: { apikey: SK, Authorization: "Bearer "+SK }
  });
  return r.json();
}

async function sbPost(table, body) {
  const r = await fetch(SURL+"/rest/v1/"+table, {
    method: "POST",
    headers: { apikey: SK, Authorization: "Bearer "+SK, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  return r.json();
}

const handler = schedule("0 13 * * *", async () => {
  const companies = await sbGet("companies?select=id,name");
  if (!companies.length) return { statusCode: 200 };

  let found = 0;

  try {
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05"
    };

    const messages = [{
      role: "user",
      content: "Search the web for real business news from the last 24 hours: CEO, CFO, CHRO changes, board appointments, funding rounds, M&A deals at companies in Germany, Austria, Switzerland, Poland, Romania, Czech Republic, Hungary. Find at least 15 specific events. Reply ONLY with a JSON array: [{\"company\":\"Name\",\"trigger_type\":\"CEO Change\",\"description\":\"What happened\"}]"
    }];

    let response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages
      })
    });

    let data = await response.json();

    // Continue conversation until Claude stops using tools
    while (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });

      const toolResults = data.content
        .filter(b => b.type === "server_tool_use")
        .map(b => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: "Search completed"
        }));

      messages.push({ role: "user", content: toolResults });

      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages
        })
      });

      data = await response.json();
    }

    const textBlock = data.content?.find(b => b.type === "text");
    const txt = textBlock?.text || "[]";

    let items = [];
    try {
      const clean = txt.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("[");
      const end = clean.lastIndexOf("]");
      if (start >= 0 && end > start) items = JSON.parse(clean.substring(start, end + 1));
    } catch(e) {}

    for (const item of items) {
      if (!item.company) continue;

      // Check if company exists in list
      let comp = companies.find(c =>
        c.name.toLowerCase().includes(item.company.toLowerCase()) ||
        item.company.toLowerCase().includes(c.name.toLowerCase())
      );

      // If not found — create it automatically
      if (!comp) {
        const created = await sbPost("companies", {
          name: item.company,
          source: "Auto-Scan"
        });
        if (created && created[0]) {
          comp = created[0];
          companies.push(comp); // add to local list
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

  } catch(e) {
    console.error("HENRY nightly scan error:", e.message);
  }

  console.log("HENRY morning scan done. Total triggers saved: "+found);
  return { statusCode: 200, body: JSON.stringify({ found }) };
});

export { handler };
