"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

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
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    let payload: Record<string, unknown>;
    if (rejected) {
      if (!confirm(t.entries.unrejectConfirm)) return;
      payload = { unreject: true };
    } else {
      const reason = prompt(t.entries.rejectPrompt)?.trim();
      if (reason === undefined || reason === null) return;
      if (!reason) {
        alert(t.entries.rejectReasonRequired);
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
      alert(body.error ?? t.employees.error);
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
