import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import {
  formatDateShort,
  formatTime,
  monthBounds,
  monthWorksite,
  workedHours,
} from "@/lib/format";
import type { EntryType, TimeEntry } from "@/types";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

const SEQUENCE: EntryType[] = [
  "entrada",
  "saida_almoco",
  "volta_almoco",
  "saida",
];

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
  if (!profile.active) redirect("/pointage");

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
          href="/pointage"
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
        >
          {t.sheet.back}
        </Link>
        <h1 className="text-lg font-bold">📅 {t.sheet.title}</h1>
      </header>

      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white px-3 py-2 shadow-sm">
        <Link
          href={`/pointage/folha?m=${prev}`}
          className="rounded-lg px-3 py-1.5 text-lg text-slate-500 active:bg-slate-100"
        >
          ←
        </Link>
        <span className="font-semibold capitalize">{monthLabel}</span>
        <Link
          href={`/pointage/folha?m=${next}`}
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
          <p className="mt-1 text-2xl font-bold text-teal-700">{totalDays}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t.sheet.totalHours}
          </p>
          <p className="mt-1 text-2xl font-bold text-teal-700">
            {totalHours > 0
              ? totalHours.toFixed(2).replace(".", ",")
              : "—"}
          </p>
        </div>
      </div>

      {days.length === 0 ? (
        <p className="rounded-2xl bg-white py-8 text-center text-slate-400 shadow-sm">
          {t.sheet.noData}
        </p>
      ) : (
        <div className="space-y-3 pb-6">
          {days.map(([date, dayEntries]) => {
            const hours = workedHours(dayEntries);
            return (
              <div key={date} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold capitalize">
                    {new Intl.DateTimeFormat("pt-PT", {
                      weekday: "short",
                      timeZone: "UTC",
                    }).format(new Date(`${date}T12:00:00Z`))}{" "}
                    {formatDateShort(date)}
                  </span>
                  {hours !== null && (
                    <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-sm font-bold text-teal-700">
                      {hours.toFixed(2).replace(".", ",")} {t.sheet.hoursShort}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {SEQUENCE.map((type) => {
                    const entry = dayEntries.find(
                      (e) => e.entry_type === type
                    );
                    if (!entry) return null;
                    const flagged = Object.keys(entry.flags ?? {}).some(
                      (f) => f !== "photo_purged" && f !== "offline_sync"
                    );
                    return (
                      <div key={type} className="flex justify-between">
                        <span className="text-slate-500">{t.types[type]}</span>
                        <span className="font-semibold">
                          {flagged && <span className="mr-1">⚠</span>}
                          {formatTime(entry.created_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="px-1 text-xs text-slate-400">{t.sheet.flaggedNote}</p>
        </div>
      )}
    </main>
  );
}
