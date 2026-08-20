import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import {
  formatHoursMinutes,
  monthBounds,
  monthWorksite,
  workedHours,
} from "@/lib/format";
import type { TimeEntryWithName } from "@/types";
import { isSuspicious } from "@/lib/entries";
import SaturdayToggle from "@/components/admin/SaturdayToggle";
import Avatar from "@/components/admin/Avatar";
import PageHeader, { MetricCard } from "@/components/admin/PageHeader";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

interface Row {
  id: string;
  name: string;
  days: number;
  hours: number;
  flagged: number;
  pending: number;
  includeSaturdays: boolean;
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
  const { data, error: queryError } = await supabase
    .from("time_entries")
    .select("*, profiles!employee_id(full_name)")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .is("rejected_at", null)
    .order("created_at");

  if (queryError) console.error("[resumo] query falhou:", queryError.message);
  const entries = (data ?? []) as TimeEntryWithName[];

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "employee")
    .order("full_name");

  const { data: sheetSettings } = await supabase
    .from("sheet_settings")
    .select("employee_id, include_saturdays")
    .eq("month", month);
  const saturdaysByEmployee = new Map(
    (sheetSettings ?? []).map((s) => [
      s.employee_id as string,
      s.include_saturdays as boolean,
    ])
  );

  // Agrupar por funcionário: dias com entrada, horas entrada→saída, suspeitos.
  const byEmployee = new Map<
    string,
    {
      name: string;
      byDay: Map<string, TimeEntryWithName[]>;
      flagged: number;
      pending: number;
    }
  >();
  for (const entry of entries) {
    const key = entry.employee_id;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: entry.profiles?.full_name ?? "?",
        byDay: new Map(),
        flagged: 0,
        pending: 0,
      });
    }
    const emp = byEmployee.get(key)!;
    if (!emp.byDay.has(entry.entry_date)) emp.byDay.set(entry.entry_date, []);
    emp.byDay.get(entry.entry_date)!.push(entry);
    if (isSuspicious(entry)) emp.flagged += 1;
    if (entry.validated_at === null) emp.pending += 1;
  }

  // Todos os funcionários aparecem (mesmo sem registos no mês) — a folha
  // e o controlo de sábados existem para todos.
  const rows: Row[] = ((employees ?? []) as { id: string; full_name: string }[])
    .map((emp) => {
      const stats = byEmployee.get(emp.id);
      let days = 0;
      let hours = 0;
      if (stats) {
        for (const dayEntries of stats.byDay.values()) {
          if (dayEntries.some((e) => e.entry_type === "entrada")) days += 1;
          hours += workedHours(dayEntries) ?? 0;
        }
      }
      return {
        id: emp.id,
        name: emp.full_name || "—",
        days,
        hours: Math.round(hours * 100) / 100,
        flagged: stats?.flagged ?? 0,
        pending: stats?.pending ?? 0,
        includeSaturdays: saturdaysByEmployee.get(emp.id) ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalHours = rows.reduce((soma, r) => soma + r.hours, 0);
  const totalFlagged = rows.reduce((soma, r) => soma + r.flagged, 0);
  const totalPending = rows.reduce((soma, r) => soma + r.pending, 0);

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
      <PageHeader
        title={t.dashboard.title}
        subtitle={t.dashboard.subtitle
          .replace("{funcionarios}", String(rows.length))
          .replace("{porValidar}", String(totalPending))}
      >
        <Link
          href={`/admin?m=${prev}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ←
        </Link>
        <span className="min-w-36 rounded-xl border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold capitalize text-slate-700">
          {monthLabel}
        </span>
        <Link
          href={`/admin?m=${next}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          →
        </Link>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <MetricCard
          label={t.dashboard.metricEmployees}
          value={rows.length}
          note={t.dashboard.metricEmployeesNote}
        />
        <MetricCard
          label={t.dashboard.totalHours}
          value={formatHoursMinutes(totalHours)}
          note={monthLabel}
        />
        <MetricCard
          label={t.dashboard.flagged}
          value={totalFlagged}
          note={t.dashboard.metricFlaggedNote}
          tone={totalFlagged > 0 ? "alerta" : "neutro"}
        />
        <MetricCard
          label={t.dashboard.pendingValidation}
          value={totalPending}
          note={t.dashboard.metricPendingNote}
          tone={totalPending > 0 ? "mau" : "bom"}
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {/* O cartao corta nos cantos; a tabela rola por dentro, senao no
            telemovel as colunas da direita ficavam inacessiveis. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">{t.dashboard.employee}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.daysPresent}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.totalHours}</th>
              <th className="px-4 py-3 text-right">{t.dashboard.flagged}</th>
              <th className="px-4 py-3 text-right">
                {t.dashboard.pendingValidation}
              </th>
              <th className="px-4 py-3 text-center">{t.dashboard.saturdays}</th>
              <th className="px-4 py-3 text-center">{t.dashboard.sheet}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  {t.dashboard.noData}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar nome={row.name} />
                    <span className="font-semibold whitespace-nowrap text-slate-900">
                      {row.name}
                    </span>
                  </span>
                </td>
                <td className="numerico px-4 py-3 text-right">{row.days}</td>
                <td className="numerico px-4 py-3 text-right">
                  {row.hours > 0 ? formatHoursMinutes(row.hours) : "—"}
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
                <td className="px-4 py-3 text-right">
                  {row.pending > 0 ? (
                    <Link
                      href={`/admin/registos?from=${from}&to=${to}&employee=${row.id}&status=pending`}
                      className="rounded-full bg-sky-100 px-2.5 py-0.5 font-semibold text-sky-800 hover:bg-sky-200"
                    >
                      {row.pending}
                    </Link>
                  ) : (
                    <span
                      className="text-emerald-600"
                      title={t.dashboard.allValidated}
                    >
                      ✓
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <SaturdayToggle
                    employeeId={row.id}
                    month={month}
                    initial={row.includeSaturdays}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <a
                    href={`/api/sheet?m=${month}&employee=${row.id}`}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    ⬇ PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3.5">
            <span className="text-[13px] font-semibold text-slate-600">
              {t.dashboard.monthTotal}
            </span>
            <span className="numerico text-lg font-medium text-slate-900">
              {formatHoursMinutes(totalHours)}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
