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
    // Step 1: Fetch news from NewsAPI
    const newsUrl = 'https://newsapi.org/v2/everything?' + new URLSearchParams({
      q: 'CEO OR CFO OR Vorstand OR Geschäftsführer OR Fusion OR Übernahme OR Funding',
      language: 'de',
      sortBy: 'publishedAt',
      pageSize: 20,
      apiKey: '4bc455fcb3de4648a707d4b3cd96a091'
    });

    const newsRes = await fetch(newsUrl);
    const newsData = await newsRes.json();

    if (!newsData.articles || !newsData.articles.length) {
      return new Response(JSON.stringify({ text: '[]', debug: 'No articles from NewsAPI' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Step 2: Prepare article summaries for Claude
    const summaries = newsData.articles
      .slice(0, 15)
      .map(a => `${a.title} — ${a.description || ''}`)
      .join('\n');

    // Step 3: Ask Claude to extract trigger events
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Analysiere diese Nachrichtentexte und extrahiere Business-Ereignisse (CEO/CFO/Vorstand-Wechsel, M&A, Funding, Expansion, Restrukturierung). Antworte NUR mit einem JSON-Array, kein anderer Text:
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Was genau passiert ist"}]

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
