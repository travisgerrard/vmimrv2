"use client";

import { useState } from "react";
import Link from "next/link";

function CodeBlock({ code, language = "" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative group">
      <pre className={`bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto whitespace-pre-wrap break-all ${language}`}>
        <code>{code}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">{title}</h2>
      {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}

const BASE_URL = "https://www.vmimr.com";
const GITHUB_RAW = "https://raw.githubusercontent.com/travisgerrard/vmimrv2/main/cli/medical-notes.mjs";

export default function IntegrationsPage() {
  return (
    <main className="container mx-auto p-4 md:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API & Integrations</h1>
          <p className="text-sm text-gray-500 mt-1">Use the CLI or API to create and search posts programmatically.</p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← Back</Link>
      </div>

      {/* Quick Install */}
      <Section
        title="CLI — Quick Install"
        description="No repo clone or npm install needed. The CLI has zero external dependencies — just download and run with Node.js 18+."
      >
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Download</p>
        <CodeBlock code={`curl -sL ${GITHUB_RAW} -o /tmp/mn.mjs`} />

        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-4 mb-2">Run</p>
        <CodeBlock code={`MEDICAL_NOTES_EMAIL="you@example.com" \\
MEDICAL_NOTES_PASSWORD="yourpassword" \\
MEDICAL_NOTES_URL="${BASE_URL}" \\
  node /tmp/mn.mjs add "Your research note..." --tags cardiology`} />

        <p className="text-xs text-gray-400 mt-3">
          Or install via npx (downloads all repo dependencies — slower):
        </p>
        <CodeBlock code={`npx github:travisgerrard/vmimrv2 add "..." --tags cardiology`} />
      </Section>

      {/* Environment Variables */}
      <Section
        title="Environment Variables"
        description="Set these in your shell profile or pass them inline per command."
      >
        <div className="space-y-3">
          {[
            { name: "MEDICAL_NOTES_EMAIL", desc: "Your account email address" },
            { name: "MEDICAL_NOTES_PASSWORD", desc: "Your account password (set via Settings → Update Password)" },
            { name: "MEDICAL_NOTES_URL", desc: `App URL — use ${BASE_URL} for production` },
          ].map(({ name, desc }) => (
            <div key={name} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-3 bg-gray-50 rounded-lg">
              <code className="text-sm font-mono text-purple-700 whitespace-nowrap">{name}</code>
              <span className="text-sm text-gray-600">{desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* CLI Commands */}
      <Section title="CLI Commands">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Create a post</p>
            <CodeBlock code={`node /tmp/mn.mjs add "Your note content here" --tags cardiology,hepatology`} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Create from a file</p>
            <CodeBlock code={`node /tmp/mn.mjs add --file ./research.md --tags patient`} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Pipe content (great for agents)</p>
            <CodeBlock code={`echo "Research summary..." | node /tmp/mn.mjs add --tags urgent`} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">List recent posts</p>
            <CodeBlock code={`node /tmp/mn.mjs list --limit 10 --tag cardiology`} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">Search posts</p>
            <CodeBlock code={`node /tmp/mn.mjs search "semaglutide"`} />
          </div>
        </div>
      </Section>

      {/* REST API */}
      <Section
        title="REST API"
        description="Use the API directly from any language or agent without installing the CLI."
      >
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              1. Sign in — get a token
            </p>
            <CodeBlock code={`curl -X POST ${BASE_URL}/api/auth \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"yourpassword"}'`} />
            <p className="text-xs text-gray-400 mt-1">Returns <code className="bg-gray-100 px-1 rounded">{"{ access_token, expires_in, user }"}</code> — token is valid for 1 hour.</p>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">2. Create a post</p>
            <CodeBlock code={`curl -X POST ${BASE_URL}/api/posts \\
  -H "Authorization: Bearer <access_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Your note...","tags":["cardiology"]}'`} />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">3. List / search posts</p>
            <CodeBlock code={`# List recent
curl "${BASE_URL}/api/posts?limit=20" \\
  -H "Authorization: Bearer <access_token>"

# Full-text search
curl "${BASE_URL}/api/posts?q=semaglutide&limit=10" \\
  -H "Authorization: Bearer <access_token>"

# Filter by tag
curl "${BASE_URL}/api/posts?tag=cardiology" \\
  -H "Authorization: Bearer <access_token>"`} />
          </div>
        </div>
      </Section>

      {/* Agent prompt */}
      <Section
        title="Agent System Prompt"
        description="Copy this into your AI agent's instructions so it can save notes automatically."
      >
        <CodeBlock code={`You have access to a medical notes system at ${BASE_URL}.

To save a research finding or note:
1. Download the CLI (once per session):
   curl -sL ${GITHUB_RAW} -o /tmp/mn.mjs

2. Save a note:
   MEDICAL_NOTES_EMAIL="you@example.com" \\
   MEDICAL_NOTES_PASSWORD="yourpassword" \\
   MEDICAL_NOTES_URL="${BASE_URL}" \\
     node /tmp/mn.mjs add "<content>" --tags <tag1>,<tag2>

Save clinically relevant findings, drug info, guidelines, and research summaries as notes.`} />
      </Section>

      <p className="text-center text-sm text-gray-400 mt-4">
        Need an account?{" "}
        <Link href="/settings" className="text-blue-600 hover:underline">
          Set a password in Settings
        </Link>{" "}
        to enable CLI access.
      </p>
    </main>
  );
}
