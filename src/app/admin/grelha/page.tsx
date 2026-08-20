import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n";
import {
  formatHoursMinutes,
  monthBounds,
  monthWorksite,
  workedHours,
} from "@/lib/format";
import type { Absence, Holiday, TimeEntryWithName } from "@/types";
import Avatar from "@/components/admin/Avatar";
import PageHeader from "@/components/admin/PageHeader";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

// Horas compactas para as células estreitas da grelha: "8h05".
// Mesma unidade do resto da aplicação — só sem o espaço, que não cabe.
function horasCompactas(hours: number): string {
  const min = Math.round(hours * 60);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

type Estado = "completo" | "incompleto" | "vazio";

// Grelha de horas: uma linha por funcionário, uma coluna por dia do mês.
// Serve para ver o mês inteiro de uma vez — quem faltou, quem tem dias
// por fechar — sem abrir funcionário a funcionário.
export default async function GrelhaPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? "")
    ? params.m!
    : monthWorksite();
  const { from, to } = monthBounds(month);

  const supabase = await createClient();
  const [
    { data: entriesData, error: queryError },
    { data: employees },
    { data: absencesData },
    { data: holidaysData },
  ] = await Promise.all([
    supabase
      .from("time_entries")
      .select("*, profiles!employee_id(full_name)")
      .gte("entry_date", from)
      .lte("entry_date", to)
      .is("rejected_at", null)
      .order("created_at"),
    // Sem filtrar por ativo, para bater certo com o resumo: quem saiu a
    // meio do mês tem horas que continuam a contar para o total.
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "employee")
      .order("full_name"),
    supabase
      .from("absences")
      .select("*")
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("holidays")
      .select("holiday_date, name")
      .gte("holiday_date", from)
      .lte("holiday_date", to),
  ]);

  if (queryError) console.error("[grelha] query falhou:", queryError.message);
  const entries = (entriesData ?? []) as TimeEntryWithName[];
  const absences = (absencesData ?? []) as Absence[];
  const holidays = (holidaysData ?? []) as Holiday[];

  // Dias do mês, com a marca de fim de semana e de feriado.
  const totalDias = Number(to.slice(8, 10));
  const feriados = new Set(holidays.map((h) => h.holiday_date));
  const dias = Array.from({ length: totalDias }, (_, i) => {
    const dia = String(i + 1).padStart(2, "0");
    const data = `${month}-${dia}`;
    const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
    return {
      data,
      label: dia,
      naoUtil: semana === 0 || semana === 6 || feriados.has(data),
    };
  });

  // Horas por funcionário e por dia.
  const porFuncionario = new Map<string, Map<string, TimeEntryWithName[]>>();
  for (const entry of entries) {
    if (!porFuncionario.has(entry.employee_id)) {
      porFuncionario.set(entry.employee_id, new Map());
    }
    const doDia = porFuncionario.get(entry.employee_id)!;
    if (!doDia.has(entry.entry_date)) doDia.set(entry.entry_date, []);
    doDia.get(entry.entry_date)!.push(entry);
  }

  const ausenciasPorFuncionario = new Map<string, Absence[]>();
  for (const a of absences) {
    if (!ausenciasPorFuncionario.has(a.employee_id)) {
      ausenciasPorFuncionario.set(a.employee_id, []);
    }
    ausenciasPorFuncionario.get(a.employee_id)!.push(a);
  }

  const linhas = ((employees ?? []) as { id: string; full_name: string }[]).map(
    (emp) => {
      const doDia = porFuncionario.get(emp.id);
      const ausencias = ausenciasPorFuncionario.get(emp.id) ?? [];
      let total = 0;
      const celulas = dias.map((dia) => {
        const registos = doDia?.get(dia.data);
        const horas = registos ? workedHours(registos) : null;
        if (horas !== null && horas !== undefined) total += horas;
        const ausencia = ausencias.find(
          (a) => a.start_date <= dia.data && a.end_date >= dia.data
        );
        // Um dia com entrada mas sem saída conta como incompleto: é o que
        // a gestão tem de ir corrigir antes de fechar o mês.
        const estado: Estado =
          horas !== null && horas !== undefined
            ? horas >= 7.5
              ? "completo"
              : "incompleto"
            : registos && registos.length > 0
              ? "incompleto"
              : "vazio";
        return {
          data: dia.data,
          naoUtil: dia.naoUtil,
          ausencia: ausencia?.kind ?? null,
          estado,
          texto:
            horas !== null && horas !== undefined
              ? horasCompactas(horas)
              : registos && registos.length > 0
                ? "?"
                : ausencia
                  ? t.grid.absenceMark[ausencia.kind]
                  : "—",
        };
      });
      return { id: emp.id, nome: emp.full_name || "—", celulas, total };
    }
  );

  const totalGeral = linhas.reduce((soma, l) => soma + l.total, 0);

  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <div>
      <PageHeader
        title={t.grid.title}
        subtitle={t.grid.subtitle.replace("{mes}", monthLabel)}
      >
        <Link
          href={`/admin/grelha?m=${prev}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ←
        </Link>
        <span className="min-w-36 rounded-xl border border-slate-300 bg-white px-4 py-2 text-center text-sm font-semibold capitalize text-slate-700">
          {monthLabel}
        </span>
        <Link
          href={`/admin/grelha?m=${next}`}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          →
        </Link>
      </PageHeader>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {/* 31 colunas não cabem em ecrã nenhum: a tabela rola na
            horizontal e a coluna do nome fica fixa à esquerda, senão
            perde-se de quem é a linha a meio do mês. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t.dashboard.employee}
                </th>
                {dias.map((dia) => (
                  <th
                    key={dia.data}
                    className={`numerico border-b border-slate-200 px-1 py-3 text-center text-[11px] font-medium ${
                      dia.naoUtil ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {dia.label}
                  </th>
                ))}
                <th className="border-b border-slate-200 px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t.dashboard.totalHours}
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr>
                  <td
                    colSpan={dias.length + 2}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    {t.dashboard.noData}
                  </td>
                </tr>
              )}
              {linhas.map((linha) => (
                <tr key={linha.id}>
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar nome={linha.nome} />
                      <span className="whitespace-nowrap text-sm font-semibold text-slate-900">
                        {linha.nome}
                      </span>
                    </span>
                  </td>
                  {linha.celulas.map((celula) => (
                    <td
                      key={celula.data}
                      title={celula.ausencia ? t.absences.kinds[celula.ausencia] : undefined}
                      className={`numerico border-b border-slate-100 px-1 py-3 text-center text-xs whitespace-nowrap ${
                        celula.estado === "completo"
                          ? "bg-emerald-50 text-emerald-700"
                          : celula.estado === "incompleto"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {celula.texto}
                    </td>
                  ))}
                  <td className="numerico border-b border-slate-100 px-4 py-3 text-right text-sm font-medium whitespace-nowrap text-slate-900">
                    {linha.total > 0 ? formatHoursMinutes(linha.total) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3.5 text-xs text-slate-500">
            <Legenda cor="bg-emerald-50 border-emerald-200" texto={t.grid.legendFull} />
            <Legenda cor="bg-amber-50 border-amber-200" texto={t.grid.legendPartial} />
            <Legenda cor="bg-slate-100 border-slate-200" texto={t.grid.legendNone} />
          </div>
          <span className="text-[13px] font-semibold text-slate-600">
            {t.grid.grandTotal}{" "}
            <span className="numerico text-slate-900">
              {formatHoursMinutes(totalGeral)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-[3px] border ${cor}`} />
      {texto}
    </span>
  );
}
