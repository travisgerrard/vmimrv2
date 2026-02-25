#!/usr/bin/env node
/**
 * medical-notes CLI
 *
 * Credentials (in priority order):
 *   1. Environment variables
 *   2. ~/.medical-notes.json  ← create with: chmod 600 ~/.medical-notes.json
 *
 * Config file format:
 *   { "email": "you@example.com", "password": "...", "url": "https://www.vmimr.com" }
 *
 * Usage:
 *   node cli/medical-notes.mjs add "content here" [--tags tag1,tag2]
 *   node cli/medical-notes.mjs add --file ./note.md [--tags tag1,tag2]
 *   echo "content" | node cli/medical-notes.mjs add [--tags tag1,tag2]
 *   node cli/medical-notes.mjs list [--limit 20] [--tag cardiology]
 *   node cli/medical-notes.mjs search "query" [--limit 20]
 *   node cli/medical-notes.mjs show <post-id>
 *   node cli/medical-notes.mjs edit <post-id>
 *   node cli/medical-notes.mjs delete <post-id> [--force]
 *
 * Via npm run (use -- to prevent npm from stripping flags):
 *   npm run cli -- add --file ./note.md --tags cardiology
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from 'fs';
import { resolve, join } from 'path';
import { homedir, tmpdir } from 'os';
import { createInterface } from 'readline';
import { spawnSync } from 'child_process';

// ── config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const cfgPath = join(homedir(), '.medical-notes.json');
  if (existsSync(cfgPath)) {
    try {
      return JSON.parse(readFileSync(cfgPath, 'utf-8'));
    } catch {
      console.error('Warning: ~/.medical-notes.json is malformed, ignoring.');
    }
  }
  return {};
}

const cfg = loadConfig();
const BASE_URL = (process.env.MEDICAL_NOTES_URL ?? cfg.url ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.MEDICAL_NOTES_EMAIL ?? cfg.email;
const PASSWORD = process.env.MEDICAL_NOTES_PASSWORD ?? cfg.password;

const isSignup = process.argv[2] === 'signup';

if (!EMAIL || !PASSWORD) {
  if (isSignup) {
    // signup doesn't need existing credentials — allow through
  } else {
    console.error('Error: credentials not found. Set env vars or create ~/.medical-notes.json');
    console.error('');
    console.error('  Option 1 — env vars:');
    console.error('    export MEDICAL_NOTES_EMAIL="you@example.com"');
    console.error('    export MEDICAL_NOTES_PASSWORD="yourpassword"');
    console.error('');
    console.error('  Option 2 — config file (~/.medical-notes.json):');
    console.error('    { "email": "you@example.com", "password": "...", "url": "https://www.vmimr.com" }');
    console.error('    chmod 600 ~/.medical-notes.json');
    console.error('');
    console.error('  New user? Run: node cli/medical-notes.mjs signup');
    process.exit(1);
  }
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
      const arg = argv[i].slice(2);
      if (arg.includes('=')) {
        const eqIdx = arg.indexOf('=');
        result.flags[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        result.flags[arg] = argv[i + 1] ?? true;
        i++;
      }
    } else {
      result.positional.push(argv[i]);
    }
  }

  // `npm run` (without --) strips --flag names, sets npm_config_<flag>=true,
  // and passes the values as positional args. Reconstruct from npm_config_* hints.
  const remaining = [...result.positional];
  for (const key of ['file', 'tags', 'tag', 'limit', 'search']) {
    const envVal = process.env[`npm_config_${key}`];
    if (!result.flags[key] && (envVal === 'true' || envVal === '') && remaining.length) {
      result.flags[key] = remaining.shift();
    }
  }
  // Replace positional with the unconsumed remainder
  result.positional = remaining;

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

function previewContent(text, lines = 4) {
  return text.trim().split('\n').slice(0, lines).join('\n');
}

function printPostSummary(post) {
  const tags = post.tags?.length ? `  [${post.tags.join(', ')}]` : '';
  const star = post.is_starred ? ' ★' : '';
  console.log(`${formatDate(post.created_at)}${star}  ${post.id.slice(0, 8)}${tags}`);
  console.log(previewContent(post.content).split('\n').map(l => `  ${l}`).join('\n'));
  console.log();
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

async function cmdShow(token, args) {
  const { positional } = parseArgs(args);
  const id = positional[0];

  if (!id) {
    console.error('Error: post ID required.  Usage: show <post-id>');
    process.exit(1);
  }

  const post = await apiFetch(token, `/api/posts/${id}`);

  const tags = post.tags?.length ? post.tags.join(', ') : '(none)';
  const star = post.is_starred ? ' ★' : '';
  console.log(`${'─'.repeat(60)}`);
  console.log(`${formatDate(post.created_at)}${star}  ${post.id}`);
  console.log(`Tags: ${tags}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(post.content);
  console.log(`${'─'.repeat(60)}`);
  console.log(`URL: ${BASE_URL}/posts/${post.id}`);
}

async function cmdEdit(token, args) {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];

  if (!id) {
    console.error('Error: post ID required.  Usage: edit <post-id>');
    process.exit(1);
  }

  const post = await apiFetch(token, `/api/posts/${id}`);

  // Write current content to a temp file
  const tmpFile = join(tmpdir(), `medical-note-${id.slice(0, 8)}.md`);
  writeFileSync(tmpFile, post.content, 'utf-8');

  const editor = process.env.VISUAL ?? process.env.EDITOR ?? 'vi';
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

  if (result.error) {
    console.error(`Failed to open editor "${editor}": ${result.error.message}`);
    unlinkSync(tmpFile);
    process.exit(1);
  }

  const newContent = readFileSync(tmpFile, 'utf-8');
  unlinkSync(tmpFile);

  if (newContent.trim() === post.content.trim()) {
    console.log('No changes detected.');
    return;
  }

  // Handle optional --tags flag to update tags as well
  const updates = { content: newContent };
  if (flags.tags) {
    updates.tags = String(flags.tags).split(',').map(t => t.trim()).filter(Boolean);
  }

  const updated = await apiFetch(token, `/api/posts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

  console.log(`Updated: ${updated.id}`);
  console.log(`  Tags : ${updated.tags?.length ? updated.tags.join(', ') : '(none)'}`);
  console.log(`  URL  : ${BASE_URL}/posts/${updated.id}`);
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
    printPostSummary(post);
  }
  console.log(`${posts.length} post${posts.length === 1 ? '' : 's'}`);
}

async function promptLine(query) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans.trim()); }));
}

async function promptPassword(query) {
  return new Promise(resolve => {
    process.stdout.write(query);
    let password = '';
    const onData = (char) => {
      char = char.toString('utf8');
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\x7f' || char === '\b') {
        if (password.length > 0) { password = password.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (char === '\x03') {
        process.exit();
      } else {
        password += char;
        process.stdout.write('*');
      }
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function cmdSignup(_token, _args) {
  console.log('Create a new medical-notes account\n');

  const email = await promptLine('Email: ');
  if (!email) { console.error('Email is required.'); process.exit(1); }

  const password = await promptPassword('Password (min 6 chars): ');
  if (!password || password.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }

  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) { console.error('Passwords do not match.'); process.exit(1); }

  const res = await fetch(`${BASE_URL}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();

  if (!res.ok) {
    console.error(`Signup failed: ${data.error ?? JSON.stringify(data)}`);
    process.exit(1);
  }

  console.log(`\n${data.message}`);

  // Offer to save credentials to config file
  const cfgPath = join(homedir(), '.medical-notes.json');
  const save = await promptLine('\nSave credentials to ~/.medical-notes.json? (Y/n) ');
  if (save.toLowerCase() !== 'n') {
    const cfgUrl = await promptLine(`App URL [${BASE_URL}]: `);
    const cfg = {
      email,
      password,
      url: cfgUrl.trim() || BASE_URL,
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    chmodSync(cfgPath, 0o600);
    console.log(`Saved to ${cfgPath} (chmod 600)`);
  }
}

async function cmdDelete(token, args) {
  const { positional, flags } = parseArgs(args);
  const id = positional[0];

  if (!id) {
    console.error('Error: post ID required.  Usage: delete <post-id>');
    process.exit(1);
  }

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
  signup                               Create a new account (interactive)
  add "content" [--tags tag1,tag2]     Create a post from inline text
  add --file ./note.md [--tags ...]    Create a post from a file
  echo "text" | add [--tags ...]       Create a post from stdin
  show <post-id>                       Print full post content
  edit <post-id> [--tags tag1,tag2]    Open post in $EDITOR and save changes
  list [--limit 20] [--tag x]          List recent posts (shows first 4 lines)
  search "query" [--limit 20]          Full-text search posts
  delete <post-id> [--force]           Delete a post (--force skips confirmation)

Credentials (first match wins):
  1. Env vars: MEDICAL_NOTES_EMAIL, MEDICAL_NOTES_PASSWORD, MEDICAL_NOTES_URL
  2. Config file: ~/.medical-notes.json
     { "email": "...", "password": "...", "url": "https://www.vmimr.com" }
     chmod 600 ~/.medical-notes.json

Tip: when using npm run, add -- to pass flags correctly:
  npm run cli -- add --file ./note.md --tags cardiology
`.trim();

if (!command || command === '--help' || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

// signup doesn't require existing credentials
if (command === 'signup') {
  await cmdSignup();
  process.exit(0);
}

const token = await signIn();

switch (command) {
  case 'add':    await cmdAdd(token, rest); break;
  case 'show':   await cmdShow(token, rest); break;
  case 'edit':   await cmdEdit(token, rest); break;
  case 'list':   await cmdList(token, rest); break;
  case 'search': await cmdList(token, rest); break;
  case 'delete': await cmdDelete(token, rest); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
}
