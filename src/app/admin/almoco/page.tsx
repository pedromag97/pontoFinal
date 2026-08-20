import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import type { LunchScheduleDay } from "@/types";
import LunchScheduleEditor from "@/components/admin/LunchScheduleEditor";
import PageHeader from "@/components/admin/PageHeader";

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
      <PageHeader
        title={t.dashboard.scheduleTitle}
        subtitle={t.dashboard.scheduleBody}
      />
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <LunchScheduleEditor
          initialDays={(data as LunchScheduleDay[] | null) ?? null}
        />
      </div>
    </div>
  );
}
