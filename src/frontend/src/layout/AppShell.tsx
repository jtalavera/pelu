import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button, Heading, Navbar, ThemeToggle } from "@design-system";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useSessionRefresh } from "../auth/useSessionRefresh";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium min-h-11 flex items-center ${
    isActive
      ? "bg-[rgb(var(--color-muted))] text-[rgb(var(--color-fg))]"
      : "text-[rgb(var(--color-muted-foreground))] hover:bg-[rgb(var(--color-muted))]"
  }`;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useSessionRefresh(true);

  function logout() {
    sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[rgb(var(--color-bg))] text-[rgb(var(--color-fg))]">
      <Navbar
        className="border-b border-[rgb(var(--color-border))] bg-[rgb(var(--color-card))] px-4 py-3 dark:bg-[rgb(var(--color-card))]"
        brand={
          <Heading as="h2" className="text-base font-semibold">
            Femme
          </Heading>
        }
        end={
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Button type="button" variant="ghost" onClick={logout} className="min-h-11">
              {t("femme.nav.logout")}
            </Button>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="w-full border-b border-[rgb(var(--color-border))] md:w-56 md:border-b-0 md:border-r md:pt-4">
          <nav className="flex flex-col gap-1 px-2 pb-4 md:px-3" aria-label="Main">
            <NavLink to="/app" end className={navClass}>
              {t("femme.nav.dashboard")}
            </NavLink>
            <NavLink to="/app/calendar" className={navClass}>
              {t("femme.nav.calendar")}
            </NavLink>
            <NavLink to="/app/services" className={navClass}>
              {t("femme.nav.services")}
            </NavLink>
            <NavLink to="/app/professionals" className={navClass}>
              {t("femme.nav.professionals")}
            </NavLink>
            <NavLink to="/app/clients" className={navClass}>
              {t("femme.nav.clients")}
            </NavLink>
            <NavLink to="/app/billing" className={navClass}>
              {t("femme.nav.billing")}
            </NavLink>
            <NavLink to="/app/settings" className={navClass}>
              {t("femme.nav.businessSettings")}
            </NavLink>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <footer className="border-t border-[rgb(var(--color-border))] px-4 py-3 text-center text-xs text-[rgb(var(--color-muted-foreground))]">
        <Link to="/design-system" className="underline-offset-4 hover:underline">
          {t("femme.footer.designSystem")}
        </Link>
      </footer>
    </div>
  );
}
