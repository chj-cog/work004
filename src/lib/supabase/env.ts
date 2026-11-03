export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export function hasSupabaseEnv(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_PUBLISHABLE_KEY !== "";
}
