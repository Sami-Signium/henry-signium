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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: 'Search the web for real business news from the last 7 days: executive changes (CEO, CFO, CHRO, board appointments/resignations), funding rounds, M&A deals at companies in Germany, Austria, Switzerland, Poland, Czech Republic, Hungary, Romania. Find at least 10 specific real events. Reply ONLY with a JSON array, no other text: [{"company":"Company Name","trigger_type":"CEO Change","description":"What happened specifically"}]'
        }]
      })
    });

    const data = await response.json();
    const textBlock = data.content ? data.content.find(b => b.type === 'text') : null;
    const text = textBlock ? textBlock.text : '[]';

    return new Response(JSON.stringify({ text }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export const config = { path: '/api/scan' };
