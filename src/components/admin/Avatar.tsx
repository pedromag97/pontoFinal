// Círculo com as iniciais, como no sistema de design LSC. Duas variantes:
// "escuro" para a barra de navegação, "claro" para dentro das tabelas.
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export default function Avatar({
  nome,
  variante = "claro",
}: {
  nome: string;
  variante?: "claro" | "escuro";
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
        variante === "escuro"
          ? "h-8 w-8 bg-marca-800 text-xs text-white"
          : "h-7 w-7 bg-marca-100 text-[11px] text-marca-800"
      }`}
    >
      {iniciais(nome)}
    </span>
  );
}
