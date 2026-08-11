"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import type { LunchScheduleDay } from "@/types";

const t = getDictionary("pt");

// Segunda→Domingo na apresentação (a BD usa 0=domingo…6=sábado).
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function LunchScheduleEditor({
  initialDays,
}: {
  initialDays: LunchScheduleDay[] | null;
}) {
  const [days, setDays] = useState<Map<number, boolean>>(
    new Map((initialDays ?? []).map((d) => [d.weekday, d.lunch_required]))
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (initialDays === null || initialDays.length === 0) {
    return (
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {t.dashboard.scheduleError}
      </p>
    );
  }

  async function toggle(weekday: number) {
    const next = !days.get(weekday);
    setBusy(true);
    setStatus(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("lunch_schedule")
      .update({ lunch_required: next })
      .eq("weekday", weekday);
    setBusy(false);
    if (error) {
      setStatus(t.dashboard.scheduleError);
      return;
    }
    setDays((prev) => new Map(prev).set(weekday, next));
    setStatus(t.dashboard.scheduleSaved);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {DISPLAY_ORDER.map((weekday) => {
          const on = days.get(weekday) ?? false;
          return (
            <button
              key={weekday}
              onClick={() => toggle(weekday)}
              disabled={busy}
              className={`rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                on
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.dashboard.weekdays[weekday]}
              <span className="ml-1.5">{on ? "🍽️" : "—"}</span>
            </button>
          );
        })}
      </div>
      {status && <p className="mt-3 text-sm text-slate-500">{status}</p>}
    </div>
  );
}
