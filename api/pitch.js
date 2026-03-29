const Anthropic = require('@anthropic-ai/sdk');

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { company, event, contact, position, language, documents } = req.body;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const lang = language === 'EN' ? 'English' : 'Deutsch';
    const docsText = documents ? `\n\nAngehängte Unterlagen:\n${documents}` : '';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Schreibe einen professionellen Executive Search Pitch-Brief auf ${lang}.

Absender: Dr. Sami Hamid, Managing Partner, Signium Austria
Empfänger: ${contact || 'Geschäftsführung'}, ${company}
Anlass: ${event}
${position ? `Vakante/relevante Position: ${position}` : ''}
${docsText}

Der Brief soll:
- Persönlich und direkt auf den Anlass eingehen
- Signium's Expertise in DACH/CEE hervorheben  
- Einen konkreten nächsten Schritt vorschlagen
- Professionell aber nicht zu formal sein
- Ca. 200-250 Wörter lang sein

Nur den Brief-Text ausgeben, keine Erklärungen.`
      }]
    });

    return res.status(200).json({ pitch: response.content[0].text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
