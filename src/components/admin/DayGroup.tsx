"use client";

import { useEffect, useState } from "react";

const CHAVE = "registos-dias-fechados";

function lerFechados(): string[] {
  try {
    const guardado = localStorage.getItem(CHAVE);
    return guardado ? (JSON.parse(guardado) as string[]) : [];
  } catch {
    return [];
  }
}

// Cabeçalho de um dia na tabela de registos, com as linhas do dia por baixo.
// O estado minimizado fica guardado no browser (localStorage), por isso
// mantém-se ao mudar de filtro, navegar ou voltar mais tarde.
export default function DayGroup({
  date,
  label,
  count,
  columns,
  children,
}: {
  date: string;
  label: string;
  count: number;
  columns: number;
  children: React.ReactNode;
}) {
  // Começa aberto no servidor e no primeiro render, para o HTML coincidir;
  // o estado guardado é aplicado logo a seguir.
  const [fechado, setFechado] = useState(false);

  useEffect(() => {
    setFechado(lerFechados().includes(date));
  }, [date]);

  function alternar() {
    const fechados = lerFechados();
    const proximo = fechados.includes(date)
      ? fechados.filter((d) => d !== date)
      : [...fechados, date];
    try {
      localStorage.setItem(CHAVE, JSON.stringify(proximo));
    } catch {
      // sem localStorage (janela privada): alterna na mesma, sem guardar
    }
    setFechado(!fechado);
  }

  return (
    <>
      <tr
        className="cursor-pointer border-b border-slate-200 bg-slate-100/80 hover:bg-slate-200/70"
        onClick={alternar}
      >
        <td
          colSpan={columns}
          className="px-3 py-1.5 text-xs font-semibold capitalize text-slate-600"
        >
          <span className="mr-1.5 inline-block w-3 text-slate-400">
            {fechado ? "▸" : "▾"}
          </span>
          {label}
          <span className="ml-2 font-normal text-slate-400">
            · {count} registos
          </span>
        </td>
      </tr>
      {!fechado && children}
    </>
  );
}
