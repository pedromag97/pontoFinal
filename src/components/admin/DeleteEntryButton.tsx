"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("pt");

export default function DeleteEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm(t.entries.deleteConfirm)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/entries/${entryId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      title={t.entries.delete}
      className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      🗑
    </button>
  );
}
