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
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    };

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: 'Search web for CEO, CFO, board changes, M&A, funding news last 7 days in Germany, Austria, Switzerland, Poland, Romania. Reply ONLY with JSON array: [{"company":"Name","trigger_type":"CEO Change","description":"What happened"}]'
      }]
    };

    // First call
    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body)
    });
    let data = await response.json();

    // If Claude used web search tool, make second call with results
    if (data.stop_reason === 'tool_use') {
      const toolUse = data.content.find(b => b.type === 'server_tool_use');
      const toolResult = data.content.find(b => b.type === 'server_tool_result') || 
                         { type: 'server_tool_result', tool_use_id: toolUse?.id, content: '' };

      body.messages = [
        body.messages[0],
        { role: 'assistant', content: data.content },
        { role: 'user', content: [{ 
          type: 'tool_result', 
          tool_use_id: toolUse?.id, 
          content: toolResult.content || 'Search completed'
        }]}
      ];

      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers, body: JSON.stringify(body)
      });
      data = await response.json();
    }

    const textBlock = data.content?.find(b => b.type === 'text');
    const text = textBlock?.text || '[]';

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
