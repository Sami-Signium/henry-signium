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
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: 'Please search the web now and find at least 10 real business news stories from the past 7 days. Focus on: CEO changes, CFO changes, board appointments, funding rounds, M&A deals at companies based in Germany, Austria, Switzerland, Poland, Romania, Czech Republic, or Hungary. After searching, reply ONLY with a valid JSON array, no markdown, no explanation: [{"company":"Company Name","trigger_type":"CEO Change","description":"What happened"}]'
        }]
      })
    });

    const data = await response.json();
    
    // Log full response for debugging
    const fullResponse = JSON.stringify(data);
    
    // Extract text from content blocks
    let text = '[]';
    if (data.content && Array.isArray(data.content)) {
      const textBlock = data.content.find(b => b.type === 'text');
      if (textBlock) text = textBlock.text;
    }

    return new Response(JSON.stringify({ text, debug: fullResponse.substring(0, 500) }), {
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
