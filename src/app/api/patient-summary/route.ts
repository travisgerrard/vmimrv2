import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
  const { post_id, feedback } = await req.json();
  if (!post_id) {
    return NextResponse.json({ error: 'post_id is required' }, { status: 400 });
  }

  // Check for existing summary (reuse if same feedback)
  const { data: existing, error: fetchError } = await supabase
    .from('patient_summaries')
    .select('*')
    .eq('post_id', post_id)
    .eq('feedback', feedback || null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ summary: existing.summary_text, id: existing.id });
  }

  // Fetch post content (now also fetching tags)
  const { data: post, error: postError } = await supabase
    .from('posts')
    .select('content, user_id, tags')
    .eq('id', post_id)
    .single();
  if (postError || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  // Only allow summary if '@patient' tag is present
  if (!post.tags || !post.tags.includes('@patient')) {
    return new NextResponse(null, { status: 204 }); // No Content
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
      user_id: post.user_id,
      summary_text: summary,
      feedback: feedback || null,
    })
    .select('*')
    .single();
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({ summary: saved.summary_text, id: saved.id });
} 