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

    const [mgmtRes, maRes, ceeRes] = await Promise.all([
      // Management changes DACH
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'Vorstandswechsel OR Führungswechsel OR "neuer Vorstand" OR "neuer Geschäftsführer" OR "neuer CEO" OR "bestellt zum" OR "ernannt zum" OR "übernimmt die Leitung" OR "tritt zurück" OR Aufsichtsrat',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 40,
        apiKey: NEWS_API_KEY
      })),
      // M&A and Funding DACH
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '"Übernahme abgeschlossen" OR "Fusion abgeschlossen" OR "übernimmt" OR "kauft" OR Finanzierungsrunde OR "erhält Finanzierung" OR Restrukturierung OR Insolvenz',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      // CEE English
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(CEO appointed OR CFO appointed OR management change OR board appointment OR merger OR acquisition OR funding round) AND (Poland OR Romania OR Hungary OR Czech OR Warsaw OR Bucharest OR Budapest OR Prague OR Vienna OR Austria)',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      }))
    ]);

    const [mgmtData, maData, ceeData] = await Promise.all([mgmtRes.json(), maRes.json(), ceeRes.json()]);

    const allArticles = [
      ...(mgmtData.articles || []),
      ...(maData.articles || []),
      ...(ceeData.articles || [])
    ];

    const seen = new Set();
    const unique = allArticles.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    if (!unique.length) {
      return new Response(JSON.stringify({ text: '[]' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const summaries = unique
      .slice(0, 50)
      .map(a => `[TITLE: ${a.title}] [URL: ${a.url}] ${a.description || ''}`)
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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Extrahiere Business-Ereignisse aus diesen Nachrichten. Kategorien: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A, Funding, Restrukturierungen. Fokus auf DACH und CEE.

Antworte NUR mit JSON-Array:
[{"company":"Firmenname","trigger_type":"CEO-Wechsel","description":"Was passiert ist","source_url":"https://..."}]

Nachrichten:
${summaries}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();

    return new Response(JSON.stringify({ text: clean, articleCount: unique.length }), {
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
