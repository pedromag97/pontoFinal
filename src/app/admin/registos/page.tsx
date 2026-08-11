import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import {
  clockDriftMinutes,
  formatDateShort,
  formatTime,
  formatTimeSeconds,
  mapsUrl,
  monthWorksite,
  todayWorksite,
} from "@/lib/format";
import type { EntryType, Profile, TimeEntryWithName } from "@/types";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

const TYPE_STYLE: Record<EntryType, string> = {
  entrada: "bg-sky-100 text-sky-800",
  saida_almoco: "bg-amber-100 text-amber-800",
  volta_almoco: "bg-lime-100 text-lime-800",
  saida: "bg-violet-100 text-violet-800",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function RegistosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; employee?: string }>;
}) {
  const params = await searchParams;
  const from = DATE_RE.test(params.from ?? "")
    ? params.from!
    : `${monthWorksite()}-01`;
  const to = DATE_RE.test(params.to ?? "") ? params.to! : todayWorksite();
  const employee = params.employee ?? "";

  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "employee")
    .order("full_name");

  let query = supabase
    .from("time_entries")
    .select("*, profiles(full_name)")
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("created_at", { ascending: false })
    .limit(500);
  if (employee) query = query.eq("employee_id", employee);

  const { data } = await query;
  const entries = (data ?? []) as TimeEntryWithName[];

  // Signed URLs (1h) para as miniaturas — bucket é privado.
  const paths = entries
    .map((e) => e.photo_path)
    .filter((p): p is string => !!p);
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("selfies")
      .createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
    });
  }

  const exportQs = new URLSearchParams({ from, to });
  if (employee) exportQs.set("employee", employee);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{t.entries.title}</h1>

      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-sm"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.from}
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.to}
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {t.entries.employee}
          </label>
          <select
            name="employee"
            defaultValue={employee}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">{t.entries.all}</option>
            {((employees ?? []) as Profile[]).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
        >
          {t.entries.filter}
        </button>
        <div className="ml-auto flex gap-2">
          <a
            href={`/api/admin/export?${exportQs.toString()}&format=csv`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ⬇ {t.entries.exportCsv}
          </a>
          <a
            href={`/api/admin/export?${exportQs.toString()}&format=xlsx`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ⬇ {t.entries.exportXlsx}
          </a>
        </div>
      </form>

      <p className="mb-3 text-xs text-slate-400">{t.entries.timezoneNote}</p>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-3">{t.entries.photo}</th>
              <th className="px-3 py-3">{t.entries.name}</th>
              <th className="px-3 py-3">{t.entries.date}</th>
              <th className="px-3 py-3">{t.entries.type}</th>
              <th className="px-3 py-3">{t.entries.serverTime}</th>
              <th className="px-3 py-3">{t.entries.clientTime}</th>
              <th className="px-3 py-3">{t.entries.gps}</th>
              <th className="px-3 py-3">{t.entries.accuracy}</th>
              <th className="px-3 py-3">{t.entries.status}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  {t.entries.noData}
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const signedUrl = entry.photo_path
                ? signedByPath.get(entry.photo_path)
                : undefined;
              const drift = clockDriftMinutes(
                entry.created_at,
                entry.client_timestamp
              );
              const flags = entry.flags ?? {};
              const lowGps = !!flags.low_gps_accuracy;
              const clockDrift = !!flags.clock_drift;
              const purged = !!flags.photo_purged;
              const suspicious = lowGps || clockDrift;

              return (
                <tr
                  key={entry.id}
                  className={`border-b border-slate-100 last:border-0 ${suspicious ? "bg-amber-50/60" : ""}`}
                >
                  <td className="px-3 py-2">
                    {signedUrl ? (
                      <a href={signedUrl} target="_blank" rel="noreferrer">
                        {/* signed URL expira — next/image não se aplica */}
                        <img
                          src={signedUrl}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover ring-1 ring-slate-200 transition hover:scale-105"
                        />
                      </a>
                    ) : (
                      <span
                        className="text-slate-300"
                        title={purged ? t.entries.flagPhotoPurged : undefined}
                      >
                        {t.entries.noPhoto}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {entry.profiles?.full_name ?? "?"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDateShort(entry.entry_date)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLE[entry.entry_type]}`}
                    >
                      {t.types[entry.entry_type]}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">
                    {formatTimeSeconds(entry.created_at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {entry.client_timestamp
                      ? formatTime(entry.client_timestamp)
                      : "—"}
                    {drift !== null && Math.abs(drift) > 5 && (
                      <span className="ml-1 text-xs text-amber-600">
                        ({drift > 0 ? "+" : ""}
                        {drift} min)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a
                      href={mapsUrl(entry.latitude, entry.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-teal-700 underline"
                      title={`${entry.latitude}, ${entry.longitude}`}
                    >
                      🗺 {t.entries.openMap}
                    </a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.gps_accuracy !== null ? (
                      <span className={lowGps ? "font-semibold text-amber-700" : ""}>
                        ±{Math.round(entry.gps_accuracy)} m
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {suspicious ? (
                      <div className="flex flex-wrap gap-1">
                        {lowGps && <Badge>{t.entries.flagLowGps}</Badge>}
                        {clockDrift && <Badge>{t.entries.flagClockDrift}</Badge>}
                      </div>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        {t.entries.ok}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      ⚠ {children}
    </span>
  );
}
