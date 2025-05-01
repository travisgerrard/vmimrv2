import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const { notes, numQuestions = 8 } = await req.json();
  if (!Array.isArray(notes) || notes.length === 0) {
    return NextResponse.json({ error: 'No notes provided.' }, { status: 400 });
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 });
  }

  // Format notes for prompt
  const notesForPrompt = notes.map(n => `[noteId: ${n.id}] "${n.content.replace(/"/g, '\"')}"`).join('\n');

  const prompt = `You are a medical educator. Given the following collection of medical notes, generate ${numQuestions} multiple-choice questions (MCQs) that test knowledge from these notes. Each MCQ should:
- Be based on the content of one or more notes, but do NOT reference the note or its ID in the question text.
- Have a question, four answer choices (one correct, three plausible distractors), and the correct answer.
- Include a noteId field in the JSON for the note that most directly inspired the question (for linking, not for display).

Return your response as a JSON array, like:
[
  {
    "noteId": "abc123",
    "question": "Why was MELD 3.0 needed?",
    "choices": [
      "To reduce sex-based disparities in liver transplant allocation",
      "To predict survival after kidney transplant",
      "To measure hepatic encephalopathy",
      "To assess frailty in cirrhosis"
    ],
    "correct": "To reduce sex-based disparities in liver transplant allocation"
  }
]

Here are the notes:
${notesForPrompt}`;

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    }),
  });

  if (!openaiRes.ok) {
    const error = await openaiRes.text();
    return NextResponse.json({ error: 'OpenAI error', details: error }, { status: 500 });
  }

  const data = await openaiRes.json();
  let quizJson = null;
  try {
    let text = data.choices?.[0]?.message?.content || '';
    // Log the raw response for debugging
    console.log('OpenAI raw response:', text);
    text = text.replace(/```json|```/g, '').trim();
    const match = text.match(/\[([\s\S]*?)\]/);
    quizJson = match ? JSON.parse('[' + match[1] + ']') : JSON.parse(text);
  } catch (e) {
    return NextResponse.json({ error: 'Failed to parse OpenAI response', details: e, raw: data.choices?.[0]?.message?.content }, { status: 500 });
  }

  return NextResponse.json({ questions: quizJson });
} 