import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

// GET /api/posts/[id] — fetch a single post
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, token } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getUserClient(token!);

  const { data: post, error } = await supabase
    .from('posts')
    .select('id, created_at, updated_at, content, tags, is_starred')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  return NextResponse.json(post);
}

// PATCH /api/posts/[id] — update content and/or tags
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, token } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.content === 'string') updates.content = body.content.trim();
  if (Array.isArray(body.tags)) updates.tags = body.tags;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const supabase = getUserClient(token!);

  const { data: post, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, created_at, content, tags')
    .single();

  if (error || !post) {
    return NextResponse.json({ error: error?.message ?? 'Post not found' }, { status: 404 });
  }

  return NextResponse.json(post);
}

// DELETE /api/posts/[id] — delete a post and its media files
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, token } = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
  }

  const supabase = getUserClient(token!);

  // Verify the post exists and belongs to this user
  const { data: post, error: fetchError } = await supabase
    .from('posts')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !post) {
    return NextResponse.json({ error: 'Post not found or not yours' }, { status: 404 });
  }

  // Delete associated storage files
  const { data: mediaFiles } = await supabase
    .from('media_files')
    .select('file_path')
    .eq('post_id', id);

  if (mediaFiles && mediaFiles.length > 0) {
    const paths = mediaFiles.map((f: { file_path: string }) => f.file_path);
    await supabase.storage.from('post-media').remove(paths);
  }

  // Delete media_files records, then the post (cascade would handle this but be explicit)
  await supabase.from('media_files').delete().eq('post_id', id);

  const { error: deleteError } = await supabase
    .from('posts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: id });
}
