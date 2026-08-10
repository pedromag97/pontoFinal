import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import EmployeeManager from "@/components/admin/EmployeeManager";

export const dynamic = "force-dynamic";

export default async function FuncionariosPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("role", { ascending: false }) // admins primeiro
    .order("full_name");

  return <EmployeeManager initialProfiles={(data ?? []) as Profile[]} />;
}
