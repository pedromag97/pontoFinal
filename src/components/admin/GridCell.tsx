"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDictionary } from "@/lib/i18n";
import { useDialogs } from "@/components/ui/Dialogs";
import { formatDateShort } from "@/lib/format";
import type { AbsenceKind } from "@/types";

const t = getDictionary("pt");

const TIPOS: AbsenceKind[] = ["ferias", "baixa", "falta"];

export interface CelulaAusencia {
  id: string;
  kind: AbsenceKind;
  start_date: string;
  end_date: string;
}

// Célula da grelha do mês. Clicar marca (ou tira) férias, baixa ou falta
// naquele dia — sem sair da grelha para a página das Ausências, que era
// onde isto vivia e obrigava a escolher funcionário e datas à mão.
export default function GridCell({
  employeeId,
  employeeName,
  data,
  texto,
  estado,
  ausencia,
  temRegistos,
}: {
  employeeId: string;
  employeeName: string;
  data: string;
  texto: string;
  estado: "completo" | "incompleto" | "vazio";
  ausencia: CelulaAusencia | null;
  /** Há picagens neste dia? */
  temRegistos: boolean;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);

  const cabecalho = `${employeeName} · ${formatDateShort(data)}`;

  async function abrir() {
    if (busy) return;

    // Marcar ausência num dia com picagens dava dados que se contradizem
    // e, pior, invisíveis: a célula mostraria as horas e a ausência ficava
    // escondida por trás delas.
    if (temRegistos && !ausencia) {
      await dialogs.alert({
        title: cabecalho,
        message: t.grid.hasEntries,
      });
      return;
    }

    if (ausencia) {
      const intervalo = ausencia.start_date !== ausencia.end_date;
      const escolha = await dialogs.choose({
        title: cabecalho,
        message: intervalo
          ? t.grid.absenceRange
              .replace("{tipo}", t.absences.kinds[ausencia.kind])
              .replace("{inicio}", formatDateShort(ausencia.start_date))
              .replace("{fim}", formatDateShort(ausencia.end_date))
          : t.grid.absenceOne.replace(
              "{tipo}",
              t.absences.kinds[ausencia.kind]
            ),
        options: [
          {
            value: "apagar",
            label: intervalo ? t.grid.removeRange : t.grid.removeOne,
            danger: true,
          },
        ],
      });
      if (escolha !== "apagar") return;

      setBusy(true);
      const { error } = await createClient()
        .from("absences")
        .delete()
        .eq("id", ausencia.id);
      setBusy(false);
      if (error) {
        await dialogs.alert({ title: cabecalho, message: t.absences.error });
        return;
      }
      router.refresh();
      return;
    }

    const escolha = await dialogs.choose({
      title: cabecalho,
      message: t.grid.markAbsence,
      options: TIPOS.map((k) => ({
        value: k,
        label: t.absences.kinds[k],
      })),
    });
    if (!escolha) return;

    setBusy(true);
    const { error } = await createClient().from("absences").insert({
      employee_id: employeeId,
      kind: escolha as AbsenceKind,
      start_date: data,
      end_date: data,
    });
    setBusy(false);
    if (error) {
      await dialogs.alert({
        title: cabecalho,
        // 23P01 = restrição de exclusão: já há ausência a cobrir este dia.
        message: error.code === "23P01" ? t.absences.overlap : t.absences.error,
      });
      return;
    }
    router.refresh();
  }

  return (
    <td
      className={`numerico border-b border-slate-100 p-0 text-center text-xs whitespace-nowrap ${
        ausencia
          ? "bg-sky-50 text-sky-700"
          : estado === "completo"
            ? "bg-emerald-50 text-emerald-700"
            : estado === "incompleto"
              ? "bg-amber-50 text-amber-700"
              : "bg-slate-100 text-slate-400"
      }`}
    >
      <button
        type="button"
        onClick={abrir}
        disabled={busy}
        title={
          ausencia
            ? `${t.absences.kinds[ausencia.kind]} — ${t.grid.clickToChange}`
            : t.grid.clickToMark
        }
        className="w-full cursor-pointer px-1 py-3 hover:brightness-95 disabled:opacity-50"
      >
        {texto}
      </button>
    </td>
  );
}
