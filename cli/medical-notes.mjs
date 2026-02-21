#!/usr/bin/env node
/**
 * medical-notes CLI
 *
 * Env vars (set in shell profile or agent environment):
 *   MEDICAL_NOTES_URL       Base URL of the running app (default: http://localhost:3000)
 *   MEDICAL_NOTES_EMAIL     Supabase account email
 *   MEDICAL_NOTES_PASSWORD  Supabase account password
 *
 * Usage:
 *   node cli/medical-notes.mjs add "content here" [--tags tag1,tag2]
 *   echo "content" | node cli/medical-notes.mjs add [--tags tag1,tag2]
 *   node cli/medical-notes.mjs add --file ./note.md [--tags tag1,tag2]
 *   node cli/medical-notes.mjs list [--limit 20] [--tag cardiology] [--search "query"]
 *   node cli/medical-notes.mjs search "query" [--limit 20]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';

const BASE_URL = (process.env.MEDICAL_NOTES_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.MEDICAL_NOTES_EMAIL;
const PASSWORD = process.env.MEDICAL_NOTES_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Error: MEDICAL_NOTES_EMAIL and MEDICAL_NOTES_PASSWORD must be set.');
  console.error('  export MEDICAL_NOTES_EMAIL="you@example.com"');
  console.error('  export MEDICAL_NOTES_PASSWORD="yourpassword"');
  process.exit(1);
}

// ── auth ─────────────────────────────────────────────────────────────────────

async function signIn() {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Auth failed: ${data.error ?? JSON.stringify(data)}`);
    process.exit(1);
  }
  return data.access_token;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      result.flags[key] = argv[i + 1] ?? true;
      i++;
    } else {
      result.positional.push(argv[i]);
    }
  }
  return result;
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

async function apiFetch(token, path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`Error ${res.status}: ${json.error ?? JSON.stringify(json)}`);
    process.exit(1);
  }
  return json;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(text, len = 120) {
  const flat = text.replace(/\n+/g, ' ').trim();
  return flat.length > len ? flat.slice(0, len) + '…' : flat;
}

// ── commands ──────────────────────────────────────────────────────────────────

async function cmdAdd(token, args) {
  const { positional, flags } = parseArgs(args);
  const tags = flags.tags ? String(flags.tags).split(',').map(t => t.trim()).filter(Boolean) : [];

  let content = '';
  if (flags.file) {
    content = readFileSync(resolve(String(flags.file)), 'utf-8');
  } else if (positional.length > 0) {
    content = positional.join(' ');
  } else {
    content = await readStdin();
  }

  if (!content?.trim()) {
    console.error('Error: no content provided. Pass as argument, --file path, or pipe via stdin.');
    process.exit(1);
  }

  const post = await apiFetch(token, '/api/posts', {
    method: 'POST',
    body: JSON.stringify({ content, tags }),
  });

  console.log(`Created: ${post.id}`);
  console.log(`  Tags : ${post.tags?.length ? post.tags.join(', ') : '(none)'}`);
  console.log(`  URL  : ${BASE_URL}/posts/${post.id}`);
}

async function cmdList(token, args) {
  const { positional, flags } = parseArgs(args);

  const params = new URLSearchParams();
  params.set('limit', String(flags.limit ?? 20));
  const search = flags.search ?? (positional.length > 0 ? positional.join(' ') : '');
  if (search) params.set('q', String(search));
  if (flags.tag) params.set('tag', String(flags.tag));

  const posts = await apiFetch(token, `/api/posts?${params}`);

  if (!posts.length) {
    console.log('No posts found.');
    return;
  }

  for (const post of posts) {
    const tags = post.tags?.length ? ` [${post.tags.join(', ')}]` : '';
    const star = post.is_starred ? ' ★' : '';
    console.log(`${formatDate(post.created_at)}${star}  ${post.id.slice(0, 8)}${tags}`);
    console.log(`  ${truncate(post.content)}`);
    console.log();
  }
  console.log(`${posts.length} post${posts.length === 1 ? '' : 's'}`);
}

async function cmdDelete(token, args) {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];

  if (!id) {
    console.error('Error: post ID required.  Usage: delete <post-id>');
    process.exit(1);
  }

  // Confirm unless --force is passed
  if (!flags.force) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => rl.question(`Delete post ${id}? (y/N) `, resolve));
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  const result = await apiFetch(token, `/api/posts/${id}`, { method: 'DELETE' });
  console.log(`Deleted: ${result.deleted}`);
}

// ── dispatch ──────────────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv;

const HELP = `
medical-notes CLI

Commands:
  add "content" [--tags tag1,tag2]     Create a post from inline text
  add --file ./note.md [--tags ...]    Create a post from a file
  echo "text" | add [--tags ...]       Create a post from stdin
  list [--limit 20] [--tag x]          List recent posts
  search "query" [--limit 20]          Full-text search posts
  delete <post-id> [--force]           Delete a post (--force skips confirmation)

Env vars required:
  MEDICAL_NOTES_EMAIL      Your account email
  MEDICAL_NOTES_PASSWORD   Your account password
  MEDICAL_NOTES_URL        App URL (default: http://localhost:3000)
`.trim();

if (!command || command === '--help' || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

const token = await signIn();

switch (command) {
  case 'add':    await cmdAdd(token, rest); break;
  case 'list':   await cmdList(token, rest); break;
  case 'search': await cmdList(token, rest); break;
  case 'delete': await cmdDelete(token, rest); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
