import { redirect } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/admin/Avatar";
import NavLink from "@/components/admin/NavLink";
import { getSessionProfile } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n";
import LogoutButton from "@/components/LogoutButton";
import NavDropdown from "@/components/admin/NavDropdown";
import { DialogProvider } from "@/components/ui/Dialogs";

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
    redirect("/registo");
  }

  return (
    <DialogProvider>
      <div className="min-h-dvh">
      {/* z-index acima das camadas do Leaflet (até ~1000), para o menu
          Gestão não ficar escondido atrás do mapa */}
      <header className="relative z-[1100] border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
          <span className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- símbolo da app, asset estático */}
            <img src="/simbolo-ponto.svg" alt="" className="h-8 w-8" />
            <span className="text-base font-bold tracking-tight text-slate-900">
              {t.app.name}
            </span>
          </span>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <NavLink href="/admin">{t.nav.dashboard}</NavLink>
            <NavLink href="/admin/grelha">{t.nav.grid}</NavLink>
            <NavLink href="/admin/registos">{t.nav.entries}</NavLink>
            <NavLink href="/admin/mapa">{t.nav.map}</NavLink>
            <NavDropdown label={t.nav.management}>
              <MenuLink href="/admin/funcionarios">
                👷 {t.nav.employees}
              </MenuLink>
              <MenuLink href="/admin/obras">🏗 {t.nav.worksites}</MenuLink>
              <MenuLink href="/admin/feriados">📅 {t.nav.holidays}</MenuLink>
              <MenuLink href="/admin/ausencias">🏖️ {t.nav.absences}</MenuLink>
              <MenuLink href="/admin/almoco">🍽️ {t.nav.lunch}</MenuLink>
              <MenuLink href="/admin/rgpd">🔒 {t.nav.privacy}</MenuLink>
            </NavDropdown>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <Avatar nome={session.profile.full_name} variante="escuro" />
            <span className="hidden text-[13px] font-semibold text-slate-900 sm:inline">
              {session.profile.full_name}
            </span>
            <LogoutButton label={t.nav.logout} />
          </div>
        </div>
      </header>
        <main className="mx-auto max-w-6xl px-6 py-7">{children}</main>
      </div>
    </DialogProvider>
  );
}

function MenuLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block whitespace-nowrap rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {children}
    </Link>
  );
}
