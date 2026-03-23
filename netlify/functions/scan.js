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

    // More specific query focused on executive changes
    const newsRes = await fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
      q: '"Vorstandswechsel" OR "neuer CEO" OR "neuer Vorstand" OR "Vorstandsvorsitzender" OR "Geschäftsführerwechsel" OR "Aufsichtsratsvorsitz" OR "Fusion abgeschlossen" OR "Übernahme abgeschlossen" OR "Finanzierungsrunde"',
      language: 'de',
      sortBy: 'publishedAt',
      pageSize: 30,
      apiKey: NEWS_API_KEY
    }));

    const newsData = await newsRes.json();
    const articles = newsData.articles || [];

    if (!articles.length) {
      return new Response(JSON.stringify({ text: '[]', debug: 'no articles' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const summaries = articles
      .slice(0, 20)
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
          content: `Extrahiere Business-Ereignisse aus diesen Nachrichten. Nur: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A, Funding, Restrukturierungen.

Antworte NUR mit JSON-Array:
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Was passiert ist"}]

Nachrichten:
${summaries}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
    
    // Clean JSON
    const clean = raw.replace(/```json|```/g, '').trim();
    
    return new Response(JSON.stringify({ text: clean, articleCount: articles.length }), {
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
