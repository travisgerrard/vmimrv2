import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/signup — create a new account
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'password must be at least 6 characters' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // If email confirmation is required, session will be null
  const confirmed = !!data.session;

  return NextResponse.json({
    id: data.user?.id,
    email: data.user?.email,
    confirmed,
    message: confirmed
      ? 'Account created. You can now log in.'
      : 'Account created. Check your email to confirm before logging in.',
  }, { status: 201 });
}
