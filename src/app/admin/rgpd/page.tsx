import { getDictionary } from "@/lib/i18n";
import RetentionButton from "@/components/admin/RetentionButton";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

export default function RgpdPage() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">🔒 RGPD</h1>

      <div className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold">🗑️ {t.dashboard.retentionTitle}</h2>
        <p className="mb-4 text-sm text-slate-500">
          {t.dashboard.retentionBody}
        </p>
        <RetentionButton
          label={t.dashboard.retentionButton}
          confirmText={t.dashboard.retentionConfirm}
          doneSuffix={t.dashboard.retentionDone}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="mb-2 font-semibold text-slate-800">
          Outras ferramentas RGPD
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Apagar dados de um funcionário</b> (registos + fotos, e
            opcionalmente a conta): painel Gestão → Funcionários → "Apagar
            dados (RGPD)".
          </li>
          <li>
            <b>Consentimento:</b> a data de aceitação de cada funcionário é
            visível na lista de Funcionários (coluna Consentimento).
          </li>
          <li>
            <b>Retenção automática:</b> além do botão acima, um cron mensal
            (dia 1) apaga as fotos com mais de 6 meses — os registos de
            horas/GPS mantêm-se para os salários.
          </li>
        </ul>
      </div>
    </div>
  );
}
