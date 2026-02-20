# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server
npm run build     # Build for production
npm run start     # Run production build
npm run lint      # Run ESLint
```

There is no test suite in this project.

## CLI (Agent Interface)

`cli/medical-notes.mjs` lets an AI agent (or any script) create and query posts without the UI. Accounts are created manually in Supabase Dashboard → Authentication → Users.

### Agent install (no repo clone needed)

The CLI has zero external dependencies — agents can download and run it directly:

```bash
curl -sL https://raw.githubusercontent.com/travisgerrard/vmimrv2/main/cli/medical-notes.mjs -o /tmp/mn.mjs

MEDICAL_NOTES_EMAIL="you@example.com" \
MEDICAL_NOTES_PASSWORD="yourpassword" \
MEDICAL_NOTES_URL="https://www.vmimr.com" \
  node /tmp/mn.mjs add "Research finding..." --tags cardiology
```

Or via npx (installs all repo deps — slower):
```bash
npx github:travisgerrard/vmimrv2 add "..." --tags cardiology
```

### Local dev setup

Add to shell profile:
```bash
export MEDICAL_NOTES_EMAIL="you@example.com"
export MEDICAL_NOTES_PASSWORD="yourpassword"
export MEDICAL_NOTES_URL="http://localhost:3000"   # or https://www.vmimr.com
```

**Usage:**
```bash
npm run cli add "Today I learned about MELD 3.0 scoring..." --tags cardiology,hepatology
npm run cli add --file ./research.md --tags patient
echo "content" | npm run cli add --tags urgent
npm run cli list                        # 20 most recent posts
npm run cli list --tag cardiology       # filter by tag
npm run cli search "hepatic encephalopathy"
```

**API routes:**
- `POST /api/auth` — `{email, password}` → `{access_token}` (Supabase JWT)
- `POST /api/posts` — create a post; `Authorization: Bearer <token>`
- `GET /api/posts` — list/search; supports `?q=`, `?tag=`, `?limit=`

RLS handles per-user data scoping automatically — no service role key needed.

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `OPENAI_API_KEY` — OpenAI API key (server-side only, used in API routes and edge functions)

## Architecture Overview

This is a **Next.js 15 + Supabase + OpenAI** medical note-taking app. The stack:
- **Frontend**: Next.js App Router, React 19, Tailwind CSS, SWR
- **Backend**: Supabase (Postgres + Auth + Storage), Supabase Edge Functions (Deno)
- **AI**: OpenAI API (GPT-4o-mini for quiz/summary, Assistants API for PDF processing)

### Key Data Flow

`src/lib/supabase.ts` exports the browser Supabase client used throughout client components. Server-side route handlers create their own clients using env vars directly.

The home page (`src/app/page.tsx`) is a **server component** that fetches initial posts and passes them to `PostsClient.tsx`, which handles all interactive state: search (debounced 250ms), filtering, infinite scroll (SWR Infinite), and media signed URLs.

SWR is configured in `src/app/SWRProvider.tsx` with a localStorage cache provider for offline-first behavior.

### Database Schema

- **posts** — core note content with `fts` tsvector column for full-text search (GIN indexed), `secret_url` for anonymous sharing
- **patient_summaries** — AI-generated patient-friendly rewrites linked to posts
- **media_files** — PDF/image attachments referencing Supabase Storage paths in the `post-media` bucket
- **quizzes** — MCQ quiz sessions with questions stored as JSON

All tables use Supabase RLS policies. Migrations live in `supabase/migrations/`.

### API Routes (`src/app/api/`)

Both routes run on Edge Runtime and use the OpenAI API server-side:
- **`/api/generate-quiz`** — POST, generates MCQ questions from selected post IDs or date range using GPT-4o-mini
- **`/api/patient-summary`** — POST, generates or retrieves patient-friendly rewrite; requires the post to have a "patient" tag

### Supabase Edge Function

`supabase/functions/summarize-document/` — Deno function that processes PDF uploads via the OpenAI Assistants API (uploads file → creates thread → polls for completion → saves summary to `posts.summary`). Deploy with `supabase functions deploy summarize-document`.

### Page Structure

- `/` — Home, search, filters, infinite scroll list of posts
- `/posts/new` — Create post with drag-and-drop file uploads
- `/posts/[id]` — View post, star/delete, trigger patient summary, view media
- `/posts/[id]/edit` — Edit post content
- `/quiz` — Quiz dashboard; select posts or date range to generate MCQs
- `/quiz/[quizId]` — View quiz results with source note links
- `/share/[secret_url]` — Public read-only post view (no auth required)

### Client Component: PostsClient.tsx

The most complex file in the codebase. Manages:
- Auth session state
- Search with URL sync (`?q=` param)
- Star/own post filters
- Signed URL generation for media (5-min expiry)
- Background refresh polling
- Scroll position restoration via sessionStorage
- Memoized post list rendering to avoid re-renders on input change

### Path Alias

`@/*` maps to `src/*` (configured in `tsconfig.json`).

## Notable Patterns

- **Markdown rendering**: `react-markdown` + `remark-gfm` with a custom link renderer that replaces `<a>` with `<span>` inside post cards to prevent nested anchor elements
- **Signed URLs**: Media files are stored with private paths; signed URLs are generated client-side on load and cached in component state
- **Sharing**: Posts get a `secret_url` (UUID) enabling anonymous read access via RLS policy without requiring login
- **TypeScript**: Strict mode; `any` usage requires `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments
