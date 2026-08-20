"use client";

import { useEffect, useRef } from "react";

// Dropdown do menu de navegação. A navegação do Next.js é client-side
// (a página não recarrega), por isso fecha explicitamente:
// - ao clicar num item do menu;
// - ao clicar fora do menu.
export default function NavDropdown({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
      }
    }
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className="cursor-pointer select-none list-none rounded-xl px-3.5 py-2 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
        {label} <span className="text-xs">▾</span>
      </summary>
      <div
        className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
