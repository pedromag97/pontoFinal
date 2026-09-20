"use client";

import { useState } from "react";
import { getDictionary } from "@/lib/i18n";
import type { EntryType } from "@/types";

const t = getDictionary("pt");

// "A app não me deixa picar". Válvula de escape para quando o fluxo
// normal encrava — chave de acesso perdida, câmara que não abre, GPS que
// nunca chega. Não depende de nada disso: só de rede.
export default function ProblemButton({
  entryType,
  contexto,
}: {
  /** Que movimento estava a tentar, se já tinha escolhido. */
  entryType?: EntryType | null;
  /** O que a app viu falhar, juntado ao aviso. */
  contexto?: Record<string, unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviar" | "enviado" | "erro">(
    "idle"
  );

  async function enviar() {
    setEstado("enviar");
    try {
      const res = await fetch("/api/registo/problema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_type: entryType ?? null,
          note: nota,
          context: contexto ?? {},
        }),
      });
      if (!res.ok) throw new Error();
      setEstado("enviado");
    } catch {
      setEstado("erro");
    }
  }

  if (estado === "enviado") {
    return (
      <p className="mb-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
        {t.problem.sent}
      </p>
    );
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="mb-5 w-full rounded-2xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-900 active:bg-amber-100"
      >
        ⚠️ {t.problem.button}
      </button>
    );
  }

  return (
    <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">⚠️ {t.problem.title}</p>
      <p className="mb-3 mt-1 text-sm text-amber-800">{t.problem.body}</p>
      <textarea
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        rows={3}
        placeholder={t.problem.placeholder}
        className="mb-3 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
      />
      {estado === "erro" && (
        <p className="mb-2 text-sm font-semibold text-red-700">
          {t.problem.error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={enviar}
          disabled={estado === "enviar"}
          className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white active:bg-amber-700 disabled:opacity-50"
        >
          {estado === "enviar" ? t.problem.sending : t.problem.send}
        </button>
        <button
          onClick={() => setAberto(false)}
          className="flex-1 rounded-xl border border-amber-300 bg-white py-2.5 text-sm font-semibold text-amber-900"
        >
          {t.capture.cancel}
        </button>
      </div>
    </div>
  );
}
