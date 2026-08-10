import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

const t = getDictionary("pt");

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile.role !== "admin" || !session.profile.active) {
    redirect("/pointage");
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-lg font-bold text-teal-800">
            📍 {t.app.name}
          </span>
          <nav className="flex gap-1 text-sm font-medium">
            <NavLink href="/admin">{t.nav.dashboard}</NavLink>
            <NavLink href="/admin/registos">{t.nav.entries}</NavLink>
            <NavLink href="/admin/funcionarios">{t.nav.employees}</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {session.profile.full_name}
            </span>
            <LogoutButton label={t.nav.logout} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </Link>
  );
}
