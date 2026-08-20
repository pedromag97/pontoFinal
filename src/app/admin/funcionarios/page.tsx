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
      supabase.from("webauthn_credentials").select("employee_id, device_type"),
    ]);

  // Quantos telemóveis registados por funcionário (impressão digital).
  // Hoje é sempre 0 ou 1 — a base de dados não deixa passar disso.
  const devicesByEmployee: Record<string, number> = {};
  // Chave sincronizada (iCloud/Google): pode existir noutro aparelho do
  // próprio, por isso a gestão vê-a marcada.
  const syncedByEmployee: Record<string, boolean> = {};
  for (const row of (credenciais ?? []) as {
    employee_id: string;
    device_type: string | null;
  }[]) {
    devicesByEmployee[row.employee_id] =
      (devicesByEmployee[row.employee_id] ?? 0) + 1;
    if (row.device_type === "multiDevice") {
      syncedByEmployee[row.employee_id] = true;
    }
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
      syncedByEmployee={syncedByEmployee}
    />
  );
}
