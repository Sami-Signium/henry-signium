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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'You are a business news analyst. You MUST reply ONLY with a valid JSON array. No explanations, no text, just the JSON array. Example: [{"company":"Siemens","trigger_type":"CEO Change","description":"New CEO appointed"}]',
        messages: [{
          role: 'user',
          content: 'Search for business news from March 2026: CEO, CFO, board changes, M&A, funding at companies in Germany, Austria, Switzerland, Poland, Romania. Return ONLY a JSON array, nothing else.'
        }]
      })
    });

    const data = await response.json();
    let text = '[]';
    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find(b => b.type === 'text');
      if (textBlock) text = textBlock.text;
    }

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
