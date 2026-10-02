import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { post_id, feedback } = body as { post_id?: unknown; feedback?: unknown };
  if (typeof post_id !== 'string' || !post_id) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 });
  }
  if (feedback != null && typeof feedback !== 'string') {
    return NextResponse.json({ error: 'feedback must be a string' }, { status: 400 });
  }
  const normalizedFeedback = feedback || null;

  // Readability is not ownership: shared/public posts must not authorize summaries.
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('id, content, user_id, tags')
    .eq('id', post_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (postError || !post || post.user_id !== user.id) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  // Only allow summary if 'patient' tag is present.
  if (!post.tags || !post.tags.includes('patient')) {
    return new NextResponse(null, { status: 204 });
  }

  // Check for existing summary (reuse if same feedback)
  let existingQuery = supabase
    .from('patient_summaries')
    .select('id, summary_text')
    .eq('post_id', post_id)
    .eq('user_id', user.id);
  existingQuery = normalizedFeedback === null
    ? existingQuery.is('feedback', null)
    : existingQuery.eq('feedback', normalizedFeedback);
  const { data: existing, error: fetchError } = await existingQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ summary: existing.summary_text, id: existing.id });
  }

  // Prepare OpenAI prompt
  const prompt = `Rewrite the following medical note for a patient. Make it concise, remove medical jargon, and strip formatting. ${feedback ? `Additional instructions: ${feedback}` : ''}\n\nNote:\n${post.content}`;

  // Call OpenAI
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return NextResponse.json({ error: 'OpenAI API key not configured.' }, { status: 500 });
  }
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    }),
  });

  if (!openaiRes.ok) {
    const error = await openaiRes.text();
    return NextResponse.json({ error: 'OpenAI error', details: error }, { status: 500 });
  }
  const data = await openaiRes.json();
  const summary = data.choices?.[0]?.message?.content?.trim() || '';
  if (!summary) {
    return NextResponse.json({ error: 'No summary generated.' }, { status: 500 });
  }

  // Save to patient_summaries
  const { data: saved, error: saveError } = await supabase
    .from('patient_summaries')
    .insert({
      post_id,
      user_id: user.id,
      summary_text: summary,
      feedback: normalizedFeedback,
    })
    .select('id, summary_text')
    .single();
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({ summary: saved.summary_text, id: saved.id });
}
