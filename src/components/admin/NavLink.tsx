"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Item da barra de navegação. A página atual fica marcada a azul claro,
// como no sistema de design — sem isto não se percebe onde se está.
export default function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // "/admin" só marca na própria página; as outras marcam também nas
  // subpáginas (ex.: /admin/registos/...).
  const ativo =
    href === "/admin" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`rounded-xl px-3.5 py-2 ${
        ativo
          ? "bg-marca-100 font-semibold text-marca-800"
          : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {children}
    </Link>
  );
}
