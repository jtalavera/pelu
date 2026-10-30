import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { PlatformShell } from "./layout/PlatformShell";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { PlatformAdminRoute } from "./auth/PlatformAdminRoute";
import { AdminOnlyRoute } from "./auth/AdminOnlyRoute";
import { ProfessionalOrAdminRoute, RedirectToTechnicalSheet } from "./auth/ProfessionalOrAdminRoute";
import DesignSystemShowcasePage from "./pages/DesignSystemShowcasePage";
import DashboardPage from "./pages/DashboardPage";
import DashboardsPage from "./pages/DashboardsPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LoginPage from "./pages/LoginPage";
import BusinessSettingsPage from "./pages/BusinessSettingsPage";
import CatalogPage from "./pages/CatalogPage";
import FiscalStampSettingsPage from "./pages/FiscalStampSettingsPage";
import TaxSettingsPage from "./pages/TaxSettingsPage";
import ClientsPage from "./pages/ClientsPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import ClientTechnicalSheetPage from "./pages/ClientTechnicalSheetPage";
import ProfessionalClientsPage from "./pages/ProfessionalClientsPage";
import InactiveClientsPage from "./pages/InactiveClientsPage";
import CalendarPage from "./pages/CalendarPage";
import BillingPage from "./pages/BillingPage";
import ServiceRecordsPage from "./pages/ServiceRecordsPage";
import PropinasPage from "./pages/PropinasPage";
import CommissionsPage from "./pages/commissions/CommissionsPage";
import CommissionSettlementPage from "./pages/commissions/CommissionSettlementPage";
import MyCommissionsPage from "./pages/commissions/MyCommissionsPage";
import SettingsLayout from "./pages/settings/SettingsLayout";
import AuditSettingsPage from "./pages/settings/AuditSettingsPage";
import PlatformAuditPage from "./pages/PlatformAuditPage";
import ActivatePage from "./pages/ActivatePage";
import SharedDevicePage from "./pages/SharedDevicePage";
import SharedDevicesSettingsPage from "./pages/settings/SharedDevicesSettingsPage";
import { SHARED_DEVICE_PATH } from "./auth/sharedDevice";
import { NotInPinSessionRoute } from "./auth/NotInPinSessionRoute";
import ImpersonatePage from "./pages/ImpersonatePage";
import { IMPERSONATION_PATH } from "./auth/impersonation";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import FeatureFlagsPage from "./pages/FeatureFlagsPage";
import PlatformGlobalFeatureFlagsPage from "./pages/PlatformGlobalFeatureFlagsPage";
import SifenCertificatesPage from "./pages/SifenCertificatesPage";
import PlatformDashboardPage from "./pages/PlatformDashboardPage";
import PlatformTenantSifenPage from "./pages/PlatformTenantSifenPage";
import PlatformTenantsPage from "./pages/PlatformTenantsPage";
import PlatformSkinPage from "./pages/PlatformSkinPage";
import PlatformTiersPage from "./pages/PlatformTiersPage";
import PlatformImportPage from "./pages/PlatformImportPage";
import PlatformStockIntegrationPage from "./pages/PlatformStockIntegrationPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/activate" element={<ActivatePage />} />
      <Route path={SHARED_DEVICE_PATH} element={<SharedDevicePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/design-system" element={<DesignSystemShowcasePage />} />
      <Route path={IMPERSONATION_PATH} element={<ImpersonatePage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/app/calendar" element={<CalendarPage />} />
        <Route element={<NotInPinSessionRoute />}>
          <Route path="/app/my-commissions" element={<MyCommissionsPage />} />
          {/* HU-68 AC9: admins get the full client screens, professionals a name list + the
              technical sheet. Not reachable in a PIN session (calendar-only, HU-66). */}
          <Route
            path="/app/clients"
            element={
              <ProfessionalOrAdminRoute
                admin={<ClientsPage />}
                professional={<ProfessionalClientsPage />}
              />
            }
          />
          <Route
            path="/app/clients/:id"
            element={
              <ProfessionalOrAdminRoute
                admin={<ClientDetailPage />}
                professional={<RedirectToTechnicalSheet />}
              />
            }
          />
          <Route path="/app/clients/:id/technical-sheet" element={<ClientTechnicalSheetPage />} />
        </Route>
        {/* HU-24 AC-12/13: everything below is admin-only — professionals go to their calendar. */}
        <Route element={<AdminOnlyRoute />}>
          <Route path="/app" element={<DashboardPage />} />
          <Route path="/app/dashboards" element={<DashboardsPage />} />
          {/* Catalog redesign: Servicios, Productos and Profesionales are views of one screen. */}
          <Route path="/app/catalog" element={<CatalogPage />} />
          <Route path="/app/services" element={<Navigate to="/app/catalog?view=services" replace />} />
          <Route path="/app/products" element={<Navigate to="/app/catalog?view=products" replace />} />
          <Route path="/app/billing" element={<BillingPage />} />
          <Route path="/app/service-records" element={<ServiceRecordsPage />} />
          <Route path="/app/propinas" element={<PropinasPage />} />
          <Route path="/app/commissions" element={<CommissionsPage />} />
          <Route path="/app/commissions/settlements/:id" element={<CommissionSettlementPage />} />
          <Route path="/app/inactive-clients" element={<InactiveClientsPage />} />
          <Route path="/app/professionals" element={<Navigate to="/app/catalog?view=professionals" replace />} />
          <Route path="/app/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="business" replace />} />
            <Route path="business" element={<BusinessSettingsPage />} />
            <Route path="fiscal-stamp" element={<FiscalStampSettingsPage />} />
            <Route path="taxes" element={<TaxSettingsPage />} />
            <Route path="sifen" element={<SifenCertificatesPage />} />
            <Route path="audit" element={<AuditSettingsPage />} />
            <Route path="devices" element={<SharedDevicesSettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route
        element={
          <PlatformAdminRoute>
            <PlatformShell />
          </PlatformAdminRoute>
        }
      >
        <Route path="/platform" element={<PlatformDashboardPage />} />
        <Route path="/platform/tenants" element={<PlatformTenantsPage />} />
        <Route path="/platform/tenants/:tenantId/sifen" element={<PlatformTenantSifenPage />} />
        <Route path="/platform/tiers" element={<PlatformTiersPage />} />
        <Route path="/platform/skin" element={<PlatformSkinPage />} />
        <Route
          path="/platform/global-feature-flags"
          element={<PlatformGlobalFeatureFlagsPage />}
        />
        <Route path="/platform/feature-flags" element={<FeatureFlagsPage />} />
        <Route path="/platform/import" element={<PlatformImportPage />} />
        <Route path="/platform/stock" element={<PlatformStockIntegrationPage />} />
        <Route path="/platform/audit" element={<PlatformAuditPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
