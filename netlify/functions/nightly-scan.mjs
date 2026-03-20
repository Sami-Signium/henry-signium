import { schedule } from "@netlify/functions";

const SURL = "https://ftdxhswcnghlmcagrsox.supabase.co";
const SK = "sb_publishable_c8YygosML2xrImmWCpI1rw_6j_pvCRA";
const PK = "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";

async function sbGet(path) {
  const r = await fetch(SURL+"/rest/v1/"+path, {headers:{apikey:SK,Authorization:"Bearer "+SK}});
  return r.json();
}

async function sbPost(body) {
  await fetch(SURL+"/rest/v1/triggers", {method:"POST",headers:{apikey:SK,Authorization:"Bearer "+SK,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(body)});
}

const handler = schedule("0 3 * * *", async () => {
  const sources = await sbGet("sources?is_active=eq.true&select=id,name,url");
  const companies = await sbGet("companies?select=id,name");
  if (!sources.length || !companies.length) return {statusCode:200};

  const groups = [];
  for (let i = 0; i < companies.length; i += 12) groups.push(companies.slice(i, i+12));

  let found = 0;

  for (const src of sources) {
    for (const group of groups) {
      try {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method:"POST",
          headers:{"Authorization":"Bearer "+PK,"Content-Type":"application/json"},
          body:JSON.stringify({
            model:"llama-3.1-sonar-small-128k-online",
            max_tokens:1000,
            messages:[
              {role:"system",content:"Antworte NUR mit JSON-Array."},
              {role:"user",content:"Suche auf "+src.url+" nach Nachrichten ueber: "+group.map(c=>c.name).join(", ")+". Erkenne CEO-Wechsel, CFO-Wechsel, Funding, M&A, Expansion. JSON: [{\"company\":\"\",\"trigger_type\":\"\",\"description\":\"\",\"relevance_score\":80}] oder []."}
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
            await sbPost({company_id:comp.id,trigger_type:item.trigger_type||"Sonstige",description:item.description||"",relevance_score:parseInt(item.relevance_score)||75});
            found++;
          }
        }
        await new Promise(r=>setTimeout(r,800));
      } catch(e) { console.error(e.message); }
    }
    await fetch(SURL+"/rest/v1/sources?id=eq."+src.id, {method:"PATCH",headers:{apikey:SK,Authorization:"Bearer "+SK,"Content-Type":"application/json"},body:JSON.stringify({last_scanned_at:new Date().toISOString()})});
  }

  console.log("HENRY scan done. Found: "+found);
  return {statusCode:200,body:JSON.stringify({found})};
});

export { handler };
