import Groq from 'groq-sdk';
import 'dotenv/config';
import { withRetry } from './retry';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey || apiKey.startsWith('your_')) {
  console.warn('⚠️  GROQ_API_KEY is missing or still a placeholder in .env');
}

const groq = new Groq({ apiKey: apiKey ?? '' });

export interface AskOptions {
  json?: boolean;
}

export async function ask(prompt: string, opts: AskOptions = {}): Promise<string> {
  return withRetry(async () => {
    const res = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return res.choices[0]?.message?.content ?? '';
  }, 3, 2000);
}
