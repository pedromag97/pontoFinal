"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import LogoutButton from "@/components/LogoutButton";

const t = getDictionary("pt");

// Ecrã de consentimento RGPD apresentado no primeiro login.
// O aceite fica registado em profiles.consent_given_at.
export default function ConsentScreen({
  profileId,
  onAccepted,
}: {
  profileId: string;
  onAccepted: (iso: string) => void;
}) {
  const [refused, setRefused] = useState(false);
  const [saving, setSaving] = useState(false);

  async function accept() {
    setSaving(true);
    const iso = new Date().toISOString();
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ consent_given_at: iso })
      .eq("id", profileId);
    setSaving(false);
    if (!error) onAccepted(iso);
  }

  if (refused) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">🛑</div>
          <h1 className="mb-2 text-xl font-bold">{t.consent.refusedTitle}</h1>
          <p className="mb-6 text-slate-600">{t.consent.refusedBody}</p>
          <LogoutButton label={t.home.logout} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col p-5">
      <h1 className="mb-4 mt-4 text-xl font-bold">🔒 {t.consent.title}</h1>

      <div className="space-y-4 rounded-2xl bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm">
        <p>{t.consent.intro}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t.consent.item_photo}</li>
          <li>{t.consent.item_gps}</li>
          <li>{t.consent.item_time}</li>
        </ul>
        <p>{t.consent.purpose}</p>
        <p>{t.consent.retention}</p>
        <p className="font-medium">{t.consent.rights}</p>
      </div>

      <div className="mt-auto space-y-3 pb-2 pt-6">
        <button
          onClick={accept}
          disabled={saving}
          className="w-full rounded-2xl bg-marca-700 py-4 text-lg font-bold text-white active:bg-marca-800 disabled:opacity-60"
        >
          {t.consent.accept}
        </button>
        <button
          onClick={() => setRefused(true)}
          className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100"
        >
          {t.consent.refuse}
        </button>
      </div>
    </main>
  );
}
