"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";

const t = getDictionary("pt");

// Recusar um registo com motivo (o funcionário é notificado e regista de
// novo) ou anular uma recusa existente.
export default function RejectButton({
  entryId,
  rejected,
}: {
  entryId: string;
  rejected: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    let payload: Record<string, unknown>;
    if (rejected) {
      const ok = await dialogs.confirm({
        title: t.entries.unreject,
        message: t.entries.unrejectConfirm,
        confirmLabel: t.entries.unreject,
      });
      if (!ok) return;
      payload = { unreject: true };
    } else {
      const reason = (
        await dialogs.prompt({
          title: t.entries.reject,
          message: t.entries.rejectPrompt,
          label: t.entries.rejectReasonLabel,
          placeholder: t.entries.rejectReasonPlaceholder,
          confirmLabel: t.entries.reject,
          danger: true,
        })
      )?.trim();
      if (reason === undefined || reason === null) return;
      if (!reason) {
        await dialogs.alert({
          title: t.entries.reject,
          message: t.entries.rejectReasonRequired,
        });
        return;
      }
      payload = { reject: true, reason };
    }

    setBusy(true);
    const res = await fetch(`/api/admin/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      await dialogs.alert({
        title: t.entries.reject,
        message: body.error ?? t.employees.error,
      });
      return;
    }
    router.refresh();
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={rejected ? t.entries.unreject : t.entries.reject}
      className={`rounded-lg border px-2 py-1 text-xs disabled:opacity-50 ${
        rejected
          ? "border-red-600 bg-red-600 text-white hover:bg-red-700"
          : "border-red-200 text-red-500 hover:bg-red-50"
      }`}
    >
      🚫
    </button>
  );
}
