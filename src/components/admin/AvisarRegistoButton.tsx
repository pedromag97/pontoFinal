"use client";

import { useState } from "react";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";

const t = getDictionary("pt");

// Avisa por notificação quem ainda não registou o telemóvel. Esses estão
// a tirar selfie em todas as picagens, muitas vezes sem perceber porquê.
export default function AvisarRegistoButton({ emFalta }: { emFalta: number }) {
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  // Ninguém por avisar: esconder é melhor do que oferecer um botão que
  // não faz nada.
  if (emFalta === 0) return null;

  async function enviar() {
    const ok = await dialogs.confirm({
      title: t.employees.notifyEnroll,
      message: t.employees.notifyConfirm.replace("{n}", String(emFalta)),
      confirmLabel: t.employees.notifySend,
    });
    if (!ok) return;

    setBusy(true);
    const res = await fetch("/api/admin/avisar-registo", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      await dialogs.alert({
        title: t.employees.notifyEnroll,
        message: t.employees.error,
      });
      return;
    }
    const body = (await res.json()) as {
      enviados: string[];
      semNotificacoes: string[];
    };

    const partes = [
      t.employees.notifySent.replace("{n}", String(body.enviados.length)),
    ];
    // Nomear quem ficou de fora: a gestão tem de falar com estes à mão,
    // e sem os nomes o resultado não serve para nada.
    if (body.semNotificacoes.length > 0) {
      partes.push(
        t.employees.notifyUnreachable.replace(
          "{nomes}",
          body.semNotificacoes.join(", ")
        )
      );
    }
    await dialogs.alert({
      title: t.employees.notifyEnroll,
      message: partes.join("\n\n"),
    });
  }

  return (
    <button
      onClick={enviar}
      disabled={busy}
      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy
        ? t.employees.notifySending
        : `👆 ${t.employees.notifyEnroll} (${emFalta})`}
    </button>
  );
}
