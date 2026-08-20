"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";

const t = getDictionary("pt");

// Exigir selfie no próximo movimento de um funcionário. Uso único: assim
// que ele picar com foto, o pedido consome-se sozinho.
export default function SelfieRequestButton({
  employeeId,
  employeeName,
  pending,
}: {
  employeeId: string;
  employeeName: string;
  /** Já há um pedido por consumir? */
  pending: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const supabase = createClient();

    if (pending) {
      const ok = await dialogs.confirm({
        title: t.employees.selfieCancel,
        message: `${employeeName} — ${t.employees.selfieCancelConfirm}`,
        confirmLabel: t.employees.selfieCancel,
      });
      if (!ok) return;
      setBusy(true);
      await supabase
        .from("selfie_requests")
        .delete()
        .eq("employee_id", employeeId)
        .is("consumed_at", null);
      setBusy(false);
      router.refresh();
      return;
    }

    const reason = (
      await dialogs.prompt({
        title: t.employees.selfieRequest,
        message: `${employeeName} — ${t.employees.selfieRequestBody}`,
        label: t.employees.selfieReasonLabel,
        placeholder: t.employees.selfieReasonPlaceholder,
        confirmLabel: t.employees.selfieRequest,
      })
    )?.trim();
    if (!reason) return;

    setBusy(true);
    const { error } = await supabase
      .from("selfie_requests")
      .insert({ employee_id: employeeId, reason });
    setBusy(false);
    if (error) {
      await dialogs.alert({
        title: t.employees.selfieRequest,
        message: t.employees.error,
      });
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={pending ? t.employees.selfiePending : t.employees.selfieRequest}
      className={`rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${
        pending
          ? "border-marca-700 bg-marca-700 text-white hover:bg-marca-800"
          : "border-slate-300 text-slate-500 hover:bg-slate-50"
      }`}
    >
      📸
    </button>
  );
}
