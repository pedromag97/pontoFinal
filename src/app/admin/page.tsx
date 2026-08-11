import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import { monthBounds, monthWorksite, workedHours } from "@/lib/format";
import type { LunchScheduleDay, TimeEntryWithName } from "@/types";
import RetentionButton from "@/components/admin/RetentionButton";
import LunchScheduleEditor from "@/components/admin/LunchScheduleEditor";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

interface Row {
  name: string;
  days: number;
  hours: number;
  flagged: number;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? "")
    ? params.m!
    : monthWorksite();
  const { from, to } = monthBounds(month);

  const supabase = await createClient();
  const { data } = await supabase
    .from("time_entries")
    .select("*, profiles(full_name)")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("created_at");

  const entries = (data ?? []) as TimeEntryWithName[];

  const { data: scheduleDays } = await supabase
    .from("lunch_schedule")
    .select("*")
    .order("weekday");

  // Agrupar por funcionário: dias com entrada, horas entrada→saída, suspeitos.
  const byEmployee = new Map<string, { name: string; byDay: Map<string, TimeEntryWithName[]>; flagged: number }>();
  for (const entry of entries) {
    const key = entry.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: entry.profiles?.full_name ?? "?",
        byDay: new Map(),
        flagged: 0,
      });
    }
    const emp = byEmployee.get(key)!;
    if (!emp.byDay.has(entry.entry_date)) emp.byDay.set(entry.entry_date, []);
    emp.byDay.get(entry.entry_date)!.push(entry);
    const flags = entry.flags ?? {};
    const outOfArea = flags.out_of_area && !entry.maintenance;
    if (flags.low_gps_accuracy || flags.clock_drift || outOfArea) {
      emp.flagged += 1;
    }
  }

  const rows: Row[] = [...byEmployee.values()]
    .map((emp) => {
      let days = 0;
      let hours = 0;
      for (const dayEntries of emp.byDay.values()) {
        if (dayEntries.some((e) => e.entry_type === "entrada")) days += 1;
        hours += workedHours(dayEntries) ?? 0;
      }
      return { name: emp.name, days, hours: Math.round(hours * 100) / 100, flagged: emp.flagged };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // navegação de meses
  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-bold">{t.dashboard.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/admin?m=${prev}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            ←
          </Link>
          <span className="min-w-36 text-center font-semibold capitalize">
            {monthLabel}
          </span>
          <Link
            href={`/admin?m=${next}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
          >
            →
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">{t.dashboard.employee}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.daysPresent}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.totalHours}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.flagged}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  {t.dashboard.noData}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3 text-right">{row.days}</td>
                <td className="px-4 py-3 text-right">
                  {row.hours > 0 ? row.hours.toFixed(2).replace(".", ",") : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.flagged > 0 ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800">
                      {row.flagged}
                    </span>
                  ) : (
                    <span className="text-slate-300">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">🍽️ {t.dashboard.scheduleTitle}</h2>
        <p className="mb-4 text-sm text-slate-500">{t.dashboard.scheduleBody}</p>
        <LunchScheduleEditor
          initialDays={(scheduleDays as LunchScheduleDay[] | null) ?? null}
        />
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">🗑️ {t.dashboard.retentionTitle}</h2>
        <p className="mb-4 text-sm text-slate-500">{t.dashboard.retentionBody}</p>
        <RetentionButton
          label={t.dashboard.retentionButton}
          confirmText={t.dashboard.retentionConfirm}
          doneSuffix={t.dashboard.retentionDone}
        />
      </div>
    </div>
  );
}
