// Cabeçalho de página do back-office: título, uma linha de contexto por
// baixo e as ações à direita. É o padrão do sistema de design LSC, igual
// em todas as páginas do admin.
export default function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Botões e controlos alinhados à direita. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2.5">{children}</div>
      )}
    </div>
  );
}

// Cartão de métrica: rótulo pequeno, número grande, nota por baixo.
export function MetricCard({
  label,
  value,
  note,
  tone = "neutro",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "neutro" | "alerta" | "bom" | "mau";
}) {
  const cor = {
    neutro: "text-slate-900",
    alerta: "text-amber-700",
    bom: "text-emerald-700",
    mau: "text-red-700",
  }[tone];
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className={`numerico text-3xl font-bold tracking-tight ${cor}`}>
        {value}
      </span>
      {note && <span className="text-[11px] text-slate-400">{note}</span>}
    </div>
  );
}
