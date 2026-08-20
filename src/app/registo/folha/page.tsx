import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import {
  formatDateShort,
  formatHoursMinutes,
  formatTime,
  monthBounds,
  monthWorksite,
  workedHours,
} from "@/lib/format";
import type { TimeEntry } from "@/types";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

// Folha do mês do próprio funcionário: dias, horas de cada registo e totais.
export default async function FolhaPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  const { supabase, profile } = session;
  if (profile.role === "admin") redirect("/admin");
  if (!profile.active) redirect("/registo");

  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? "")
    ? params.m!
    : monthWorksite();
  const { from, to } = monthBounds(month);

  const { data } = await supabase
    .from("time_entries")
    .select("*")
    .eq("employee_id", profile.id)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .is("rejected_at", null)
    .order("created_at");

  const entries = (data ?? []) as TimeEntry[];

  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    if (!byDay.has(entry.entry_date)) byDay.set(entry.entry_date, []);
    byDay.get(entry.entry_date)!.push(entry);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  let totalDays = 0;
  let totalHours = 0;
  for (const [, dayEntries] of days) {
    if (dayEntries.some((e) => e.entry_type === "entrada")) totalDays += 1;
    totalHours += workedHours(dayEntries) ?? 0;
  }
  totalHours = Math.round(totalHours * 100) / 100;

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col p-5">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href="/registo"
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
        >
          {t.sheet.back}
        </Link>
        <h1 className="text-lg font-bold">📅 {t.sheet.title}</h1>
      </header>

      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Link
          href={`/registo/folha?m=${prev}`}
          className="rounded-lg px-3 py-1.5 text-lg text-slate-500 active:bg-slate-100"
        >
          ←
        </Link>
        <span className="font-semibold capitalize">{monthLabel}</span>
        <Link
          href={`/registo/folha?m=${next}`}
          className="rounded-lg px-3 py-1.5 text-lg text-slate-500 active:bg-slate-100"
        >
          →
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t.sheet.daysWorked}
          </p>
          <p className="numerico mt-1 text-2xl font-bold text-marca-700">{totalDays}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t.sheet.totalHours}
          </p>
          <p className="numerico mt-1 text-2xl font-bold text-marca-700">
            {totalHours > 0
              ? totalHours.toFixed(2).replace(".", ",")
              : "—"}
          </p>
        </div>
      </div>

      <a
        href={`/api/sheet?m=${month}`}
        className="mb-4 block rounded-2xl bg-marca-700 py-3.5 text-center text-sm font-bold text-white active:bg-marca-800"
      >
        ⬇ {t.sheet.download}
      </a>

      {days.length === 0 ? (
        <p className="rounded-2xl bg-white py-8 text-center text-slate-400 shadow-sm">
          {t.sheet.noData}
        </p>
      ) : (
        <div className="pb-6">
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="w-16">{t.sheet.colDay}</span>
              <span className="flex-1">{t.types.entrada}</span>
              <span className="flex-1">{t.types.saida}</span>
              <span className="w-16 text-right">{t.sheet.colTotal}</span>
            </div>
            {days.map(([date, dayEntries]) => {
              const hours = workedHours(dayEntries);
              const entrada = dayEntries.find((e) => e.entry_type === "entrada");
              const saida = dayEntries.find((e) => e.entry_type === "saida");
              // Dia ainda a decorrer (entrou e não saiu) fica em verde,
              // fim de semana em cinzento, como na folha desenhada.
              const aberto = !!entrada && !saida;
              const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
              const fds = weekday === 0 || weekday === 6;
              const flagged = dayEntries.some((e) =>
                Object.keys(e.flags ?? {}).some(
                  (f) => f !== "photo_purged" && f !== "offline_sync"
                )
              );
              return (
                <div
                  key={date}
                  className={`flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                    aberto ? "bg-emerald-50" : fds ? "bg-slate-50" : "bg-white"
                  }`}
                >
                  <span className="flex w-16 items-baseline gap-1.5">
                    <span className="numerico text-sm font-semibold text-slate-900">
                      {formatDateShort(date).slice(0, 2)}
                    </span>
                    <span className="text-xs capitalize text-slate-400">
                      {/* "quinta-feira" → "qui", para a coluna do dia
                          ficar estreita como na folha desenhada. */}
                      {new Intl.DateTimeFormat("pt-PT", {
                        weekday: "short",
                        timeZone: "UTC",
                      })
                        .format(new Date(`${date}T12:00:00Z`))
                        .slice(0, 3)}
                    </span>
                  </span>
                  <span className="numerico flex-1 text-sm text-slate-700">
                    {entrada ? formatTime(entrada.created_at) : "—"}
                    {flagged && <span className="ml-1">⚠</span>}
                  </span>
                  <span className="numerico flex-1 text-sm text-slate-700">
                    {saida ? formatTime(saida.created_at) : "—"}
                  </span>
                  <span
                    className={`numerico w-16 text-right text-sm font-medium ${
                      hours === null ? "text-slate-400" : "text-slate-900"
                    }`}
                  >
                    {hours === null
                      ? "—"
                      : formatHoursMinutes(hours)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 px-1 text-xs text-slate-400">{t.sheet.flaggedNote}</p>
        </div>
      )}
    </main>
  );
}
