import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { todayWorksite } from "@/lib/format";
import type { AbsenceKind, LunchScheduleDay, TimeEntry } from "@/types";
import EmployeeHome from "@/components/employee/EmployeeHome";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function PointagePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { supabase, profile } = session;
  if (profile.role === "admin") redirect("/admin");

  const t = getDictionary("pt");

  if (!profile.active) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">🚫</div>
          <h1 className="mb-2 text-xl font-bold">{t.inactive.title}</h1>
          <p className="mb-6 text-slate-600">{t.inactive.body}</p>
          <LogoutButton label={t.home.logout} />
        </div>
      </main>
    );
  }

  const today = todayWorksite();
  const { data: entries } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", profile.id)
    .eq("entry_date", today)
    .is("rejected_at", null)
    .order("created_at");

  // Registos de hoje recusados pelo backoffice — mostrados como aviso
  // para o funcionário repetir o registo.
  const { data: rejected } = await supabase
    .from("time_entries")
    .select("entry_type, rejection_reason")
    .eq("employee_id", profile.id)
    .eq("entry_date", today)
    .not("rejected_at", "is", null)
    .order("created_at");

  // Está de férias/baixa/falta hoje?
  const { data: ausencia } = await supabase
    .from("absences")
    .select("kind, end_date")
    .eq("employee_id", profile.id)
    .lte("start_date", today)
    .gte("end_date", today)
    .maybeSingle();

  // Já registou o telemóvel (impressão digital)?
  const { count: credenciais } = await supabase
    .from("webauthn_credentials")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", profile.id);

  // Horário de almoço completo (7 dias): o cliente escolhe o dia certo,
  // mesmo quando a página é servida do cache offline no dia seguinte.
  const { data: schedule } = await supabase
    .from("lunch_schedule")
    .select("weekday, lunch_required")
    .order("weekday");

  return (
    <EmployeeHome
      profile={profile}
      initialEntries={(entries ?? []) as TimeEntry[]}
      rejectedToday={
        (rejected ?? []) as { entry_type: TimeEntry["entry_type"]; rejection_reason: string | null }[]
      }
      lunchSchedule={(schedule ?? []) as LunchScheduleDay[]}
      hasCredential={(credenciais ?? 0) > 0}
      absence={
        (ausencia as { kind: AbsenceKind; end_date: string } | null) ?? null
      }
    />
  );
}
