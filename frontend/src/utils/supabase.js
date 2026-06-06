import { createClient } from "@supabase/supabase-js";

// These environment variables will be set during production deployment.
// If they are missing, we default to running in LOCAL/DEVELOPMENT mode (mocked auth).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (error) {
    console.error("Failed to initialize Supabase client:", error);
  }
} else {
  console.warn("Supabase config missing. Running in local fallback mode (mocked auth).");
}

export { supabase, isSupabaseConfigured };
