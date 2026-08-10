import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

// Devolve o utilizador autenticado + profile, ou null.
export async function getSessionProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  return { supabase, user, profile: profile as Profile };
}

// Guard para route handlers de admin. Devolve null se não for admin ativo.
export async function requireAdmin() {
  const session = await getSessionProfile();
  if (!session || session.profile.role !== "admin" || !session.profile.active) {
    return null;
  }
  return session;
}
