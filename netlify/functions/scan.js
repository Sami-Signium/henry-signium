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
      q: 'Vorstand OR CEO OR Fusion',
      language: 'de',
      sortBy: 'publishedAt',
      pageSize: 10,
      apiKey: NEWS_API_KEY
    }));

    const newsData = await newsRes.json();
    const articles = newsData.articles || [];

    // Return raw NewsAPI result for debugging
    return new Response(JSON.stringify({ 
      articleCount: articles.length,
      status: newsData.status,
      firstTitle: articles[0]?.title || 'none',
      text: '[]'
    }), {
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
