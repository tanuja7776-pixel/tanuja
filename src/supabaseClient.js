import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env.local (and to Vercel)."
  );
}

// The anon key is designed to be public. What protects the data is the
// Row Level Security policies in supabase/schema.sql, not hiding this key.
// Never put the service_role key in frontend code.
export const supabase = createClient(url, anonKey);
