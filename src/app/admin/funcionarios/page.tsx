import { createClient } from "@/lib/supabase/server";
import type { Profile, Worksite } from "@/types";
import EmployeeManager from "@/components/admin/EmployeeManager";

export const dynamic = "force-dynamic";

export default async function FuncionariosPage() {
  const supabase = await createClient();

  const [
    { data: profiles },
    { data: worksites },
    { data: assignments },
    { data: credenciais },
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .order("role", { ascending: false }) // admins primeiro
        .order("full_name"),
      supabase.from("worksites").select("*").order("active", { ascending: false }).order("name"),
      supabase.from("employee_worksites").select("employee_id, worksite_id"),
      supabase.from("webauthn_credentials").select("employee_id"),
    ]);

  // Quantos telemóveis registados por funcionário (impressão digital).
  const devicesByEmployee: Record<string, number> = {};
  for (const row of (credenciais ?? []) as { employee_id: string }[]) {
    devicesByEmployee[row.employee_id] =
      (devicesByEmployee[row.employee_id] ?? 0) + 1;
  }

  // obras atribuídas por funcionário
  const assignedByEmployee: Record<string, string[]> = {};
  for (const row of (assignments ?? []) as {
    employee_id: string;
    worksite_id: string;
  }[]) {
    (assignedByEmployee[row.employee_id] ??= []).push(row.worksite_id);
  }

  return (
    <EmployeeManager
      initialProfiles={(profiles ?? []) as Profile[]}
      worksites={(worksites ?? []) as Worksite[]}
      assignedByEmployee={assignedByEmployee}
      devicesByEmployee={devicesByEmployee}
    />
  );
}
