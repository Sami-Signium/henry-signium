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

    const newsRes = await fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
      q: 'Vorstand OR Geschäftsführer OR CEO OR CFO OR Aufsichtsrat OR Fusion OR Übernahme OR Finanzierung OR Restrukturierung',
      language: 'de',
      sortBy: 'publishedAt',
      pageSize: 50,
      apiKey: NEWS_API_KEY
    }));

    const newsData = await newsRes.json();
    const articles = newsData.articles || [];

    if (!articles.length) {
      return new Response(JSON.stringify({ text: '[]', debug: JSON.stringify(newsData).substring(0, 300) }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const summaries = articles
      .slice(0, 30)
      .map(a => `- ${a.title}${a.description ? ' | ' + a.description : ''}`)
      .join('\n');

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
          content: `Du bist ein Business Intelligence Analyst. Analysiere diese Nachrichten und extrahiere NUR relevante Ereignisse für Executive Search: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A-Deals, Funding-Runden, Restrukturierungen.

Ignoriere: Produktnews, technische Updates, allgemeine Marktberichte ohne Personalrelevanz.

Antworte NUR mit einem JSON-Array (kein anderer Text):
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Konkrete Beschreibung"}]

Wenn keine relevanten Ereignisse: []

Nachrichten:
${summaries}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const text = claudeData.content?.find(b => b.type === 'text')?.text || '[]';

    return new Response(JSON.stringify({ text }), {
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
