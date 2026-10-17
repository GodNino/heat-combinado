import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
// This public client uses the signed-in user's identity; SQL policies enforce access.
export const supabase = url && key ? createClient(url, key) : null;
