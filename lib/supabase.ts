import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Sem variáveis configuradas, o app roda só no aparelho (modo local). */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'caixadomeipesquisa@gmail.com';
