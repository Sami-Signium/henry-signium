const Anthropic = require('@anthropic-ai/sdk');

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    const from = fromDate.toISOString().split('T')[0];

    // Three parallel queries
    const queries = [
      `Führungswechsel OR Geschäftsführer OR CEO OR Vorstand OR Aufsichtsrat&language=de&sortBy=publishedAt&from=${from}`,
      `Österreich Unternehmen Übernahme OR Fusion OR Expansion OR Wachstum&language=de&sortBy=publishedAt&from=${from}`,
      `CEE management change OR leadership OR acquisition OR merger&language=en&sortBy=publishedAt&from=${from}`
    ];

    const results = await Promise.all(queries.map(q =>
      fetch(`https://newsapi.org/v2/everything?q=${q}&pageSize=10&apiKey=${NEWSAPI_KEY}`)
        .then(r => r.json())
        .then(d => d.articles || [])
        .catch(() => [])
    ));

    const articles = results.flat().filter(a => a.title && a.url);

    if (!articles.length) {
      return res.status(200).json({ triggers: [] });
    }

    // Use Claude to extract triggers
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const articleText = articles.slice(0, 20).map((a, i) =>
      `[${i}] ${a.title}\n${a.description || ''}\nURL: ${a.url}`
    ).join('\n\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Analysiere diese Nachrichten und extrahiere Sales-Trigger für Executive Search. 
Gib NUR JSON zurück, kein Text davor oder danach:
{"triggers": [{"company": "Firmenname", "event": "Was ist passiert", "type": "Führungswechsel|Expansion|Fusion|Sonstiges", "relevance": "Warum relevant für Executive Search", "url": "Artikel-URL", "date": "Datum"}]}

Nachrichten:
${articleText}`
      }]
    });

    let triggers = [];
    try {
      const text = response.content[0].text;
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      triggers = parsed.triggers || [];
    } catch(e) {
      triggers = [];
    }

    return res.status(200).json({ triggers });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
