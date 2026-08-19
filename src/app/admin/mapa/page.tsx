import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import { todayWorksite } from "@/lib/format";
import type { TimeEntryWithName, Worksite } from "@/types";
import DayMap from "@/components/admin/DayMap";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function MapaPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const params = await searchParams;
  const date = DATE_RE.test(params.d ?? "") ? params.d! : todayWorksite();

  const supabase = await createClient();

  const [{ data: entries, error: entriesError }, { data: worksites }] =
    await Promise.all([
    supabase
      .from("time_entries")
      .select("*, profiles!employee_id(full_name), worksites(name)")
      .eq("entry_date", date)
      .is("rejected_at", null)
      .order("created_at"),
    supabase.from("worksites").select("*").eq("active", true),
  ]);

  if (entriesError) console.error("[mapa] query falhou:", entriesError.message);
  const entryList = (entries ?? []) as TimeEntryWithName[];

  // Signed URLs para abrir a foto a partir do popup do mapa.
  const paths = entryList
    .map((e) => e.photo_path)
    .filter((p): p is string => !!p);
  const photoUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("selfies")
      .createSignedUrls(paths, 3600);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) photoUrls[s.path] = s.signedUrl;
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{t.map.title}</h1>
        <form method="get" className="ml-auto flex items-center gap-2">
          <label className="text-sm text-slate-500" htmlFor="d">
            {t.map.date}
          </label>
          <input
            id="d"
            type="date"
            name="d"
            defaultValue={date}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-marca-700 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-800"
          >
            {t.map.show}
          </button>
        </form>
      </div>

      <DayMap
        key={date}
        entries={entryList}
        worksites={(worksites ?? []) as Worksite[]}
        photoUrls={photoUrls}
      />
    </div>
  );
}
