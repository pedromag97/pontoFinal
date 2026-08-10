import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import { todayWorksite } from "@/lib/format";
import type { TimeEntry } from "@/types";
import EmployeeHome from "@/components/employee/EmployeeHome";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function PointagePage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const { supabase, profile } = session;
  if (profile.role === "admin") redirect("/admin");

  const t = getDictionary("fr");

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
    .order("created_at");

  return (
    <EmployeeHome
      profile={profile}
      initialEntries={(entries ?? []) as TimeEntry[]}
      today={today}
    />
  );
}
