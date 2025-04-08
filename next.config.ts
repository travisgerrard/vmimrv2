import type { NextConfig } from "next";

// Removed dotenv import and explicit loading logic.
// Next.js automatically loads .env.local.

// --- DEBUGGING: Print loaded env vars (Next.js should load these automatically) ---
// Note: These might show 'undefined' during the config phase depending on Next.js version/build step,
// but they should be available in your application code.
console.log('[next.config.ts] Checking environment variables loaded by Next.js:');
console.log(`[next.config.ts] NEXT_PUBLIC_SUPABASE_URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`[next.config.ts] NEXT_PUBLIC_SUPABASE_ANON_KEY: ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`);
// --- END DEBUGGING ---

const nextConfig: NextConfig = {
  /* config options here */
  // Ensure experimental flags or other settings aren't interfering if added later
};

export default nextConfig;
