const Anthropic = require('@anthropic-ai/sdk');

module.exports = async function handler(req, res) {
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

    const queries = [
      encodeURIComponent('Führungswechsel OR Geschäftsführer OR CEO OR Vorstand') + '&language=de&sortBy=publishedAt&from=' + from,
      encodeURIComponent('Österreich Unternehmen Übernahme OR Fusion OR Expansion') + '&language=de&sortBy=publishedAt&from=' + from,
      encodeURIComponent('CEE management change OR leadership OR acquisition') + '&language=en&sortBy=publishedAt&from=' + from
    ];

    const results = await Promise.all(queries.map(q =>
      fetch('https://newsapi.org/v2/everything?q=' + q + '&pageSize=10&apiKey=' + NEWSAPI_KEY)
        .then(r => r.json())
        .then(d => d.articles || [])
        .catch(() => [])
    ));

    const articles = results.flat().filter(a => a.title && a.url);
    if (!articles.length) return res.status(200).json({ text: '[]' });

    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const articleText = articles.slice(0, 20).map((a, i) =>
      '[' + i + '] ' + a.title + '\n' + (a.description || '') + '\nURL: ' + a.url
    ).join('\n\n');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: 'Analysiere diese Nachrichten und extrahiere Sales-Trigger für Executive Search.\nGib NUR ein JSON-Array zurück, kein Text davor oder danach:\n[{"company": "Firmenname", "trigger_type": "Führungswechsel", "description": "Was ist passiert", "source_url": "URL"}]\n\nNachrichten:\n' + articleText
      }]
    });

    return res.status(200).json({ text: response.content[0].text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
