import { createClient } from "@/lib/supabase/server";
import type { AbsenceWithName, Profile } from "@/types";
import AbsenceManager from "@/components/admin/AbsenceManager";

export const dynamic = "force-dynamic";

export default async function AusenciasPage() {
  const supabase = await createClient();

  const [{ data: employees }, { data: absences }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("role", "employee")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("absences")
      .select("*, profiles!employee_id(full_name)")
      .order("start_date", { ascending: false }),
  ]);

  return (
    <AbsenceManager
      employees={(employees ?? []) as Profile[]}
      absences={(absences ?? []) as AbsenceWithName[]}
    />
  );
}
