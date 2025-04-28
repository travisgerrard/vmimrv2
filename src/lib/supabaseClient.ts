import { createClient } from '@supabase/supabase-js';

// --- TEMPORARY DEBUGGING ---
// Ensure environment variables are defined
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // Export the URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
}
if (!supabaseAnonKey) {
  throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// --- REMOVED TEMPORARY DEBUGGING ---
// const supabaseUrl = "YOUR_SUPABASE_URL_HERE"; // <-- REMOVED
// const supabaseAnonKey = "YOUR_SUPABASE_ANON_KEY_HERE"; // <-- REMOVED

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
// --- END TEMPORARY DEBUGGING ---