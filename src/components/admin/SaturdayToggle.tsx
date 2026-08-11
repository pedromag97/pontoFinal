"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// "Apontar sábados na folha" — por funcionário e por mês.
export default function SaturdayToggle({
  employeeId,
  month,
  initial,
}: {
  employeeId: string;
  month: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("sheet_settings").upsert(
      { employee_id: employeeId, month, include_saturdays: !on },
      { onConflict: "employee_id,month" }
    );
    setBusy(false);
    if (!error) setOn(!on);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${
        on
          ? "bg-teal-700 text-white"
          : "bg-slate-200 text-slate-600 hover:bg-slate-300"
      }`}
    >
      {on ? "Sim" : "Não"}
    </button>
  );
}
