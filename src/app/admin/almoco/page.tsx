import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import type { LunchScheduleDay } from "@/types";
import LunchScheduleEditor from "@/components/admin/LunchScheduleEditor";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

export default async function AlmocoPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lunch_schedule")
    .select("*")
    .order("weekday");

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">🍽️ {t.dashboard.scheduleTitle}</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        {t.dashboard.scheduleBody}
      </p>
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <LunchScheduleEditor
          initialDays={(data as LunchScheduleDay[] | null) ?? null}
        />
      </div>
    </div>
  );
}
