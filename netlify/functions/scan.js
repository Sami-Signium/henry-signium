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

    // Two parallel searches: German personal news + English DACH business news
    const [deRes, enRes] = await Promise.all([
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'Vorstand OR Geschäftsführer OR CEO OR CFO OR CHRO OR Aufsichtsrat OR Fusion OR Übernahme OR Finanzierung OR Restrukturierung',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 50,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'appointed CEO OR new CFO OR board appointment OR merger OR acquisition OR funding round AND (Germany OR Austria OR Switzerland OR Poland OR Romania OR Hungary OR Vienna OR Berlin)',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 50,
        apiKey: NEWS_API_KEY
      }))
    ]);

    const [deData, enData] = await Promise.all([deRes.json(), enRes.json()]);

    const deArticles = deData.articles || [];
    const enArticles = enData.articles || [];
    const allArticles = [...deArticles, ...enArticles].slice(0, 30);

    if (!allArticles.length) {
      return new Response(JSON.stringify({ text: '[]', debug: 'No articles found' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Prepare summaries for Claude
    const summaries = allArticles
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
          content: `Du bist ein Business Intelligence Analyst. Analysiere diese Nachrichten und extrahiere NUR relevante Business-Ereignisse für Executive Search: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A-Deals, Funding-Runden, Restrukturierungen, DACH/CEE-Expansionen.

Ignoriere: Produktnews, technische Updates, allgemeine Marktberichte ohne Personalrelevanz.

Antworte NUR mit einem JSON-Array (kein anderer Text, keine Erklärungen):
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Konkrete Beschreibung was passiert ist"}]

Wenn keine relevanten Ereignisse gefunden: []

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
