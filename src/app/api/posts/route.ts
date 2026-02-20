import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

function getUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function getAuthenticatedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { user: null, token: null };

  const supabase = getUserClient(token);
  const { data: { user } } = await supabase.auth.getUser();
  return { user, token };
}

// POST /api/posts — create a post
export async function POST(req: NextRequest) {
  const { user, token } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { content, tags } = body;

  if (!content || typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const supabase = getUserClient(token!);
  const { data, error } = await supabase
    .from('posts')
    .insert({
      content: content.trim(),
      tags: Array.isArray(tags) ? tags : [],
      user_id: user.id,
      secret_url: uuidv4(),
    })
    .select('id, created_at, tags, content')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

// GET /api/posts — list or search the authenticated user's posts
export async function GET(req: NextRequest) {
  const { user, token } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100);
  const tag = searchParams.get('tag') ?? '';

  const supabase = getUserClient(token!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('posts')
    .select('id, created_at, content, tags, is_starred')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (q) {
    query = query.textSearch('fts', q, { type: 'websearch' });
  }

  if (tag) {
    query = query.contains('tags', [tag]);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
