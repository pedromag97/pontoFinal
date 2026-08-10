import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com service_role: ignora RLS. Usar APENAS em route handlers do
// servidor, depois de verificar que quem chama é admin (ver requireAdmin).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
