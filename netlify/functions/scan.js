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

    const [deRes, atRes, ceeRes] = await Promise.all([
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'Managementwechsel OR Vorstandswechsel OR Führungswechsel OR Personalwechsel OR "neuer Vorstand" OR "neuer Geschäftsführer" OR "Fusion abgeschlossen" OR "Übernahme abgeschlossen" OR Finanzierungsrunde OR Restrukturierung',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: 'Wien Managementwechsel OR Wien Vorstandswechsel OR Österreich Führungswechsel OR Österreich Übernahme OR Wien Geschäftsführer OR Austria merger OR Vienna acquisition OR Vienna CEO',
        language: 'de',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      })),
      fetch('https://newsapi.org/v2/everything?' + new URLSearchParams({
        q: '(CEO appointed OR CFO appointed OR management change OR board appointment OR merger OR acquisition OR funding round) AND (Poland OR Romania OR Hungary OR Czech OR Warsaw OR Bucharest OR Budapest OR Prague OR Vienna OR Austria)',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey: NEWS_API_KEY
      }))
    ]);

    const [deData, atData, ceeData] = await Promise.all([deRes.json(), atRes.json(), ceeRes.json()]);

    const allArticles = [
      ...(deData.articles || []),
      ...(atData.articles || []),
      ...(ceeData.articles || [])
    ];

    // Deduplicate by title
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

    // Build article map: title -> url for later lookup
    const articleMap = {};
    unique.forEach(a => { articleMap[a.title] = a.url; });

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
          content: `Extrahiere Business-Ereignisse aus diesen Nachrichten. Nur: Vorstandswechsel, CEO/CFO/CHRO-Wechsel, Aufsichtsratsbestellungen, M&A, Funding, Restrukturierungen. Fokus auf DACH und CEE Unternehmen.

Antworte NUR mit JSON-Array (kein anderer Text). Füge die URL des Artikels ein:
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
