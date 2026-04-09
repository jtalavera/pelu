import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import DesignSystemShowcasePage from "./pages/DesignSystemShowcasePage";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LoginPage from "./pages/LoginPage";
import BusinessSettingsPage from "./pages/BusinessSettingsPage";
import ServicesPage from "./pages/ServicesPage";
import FiscalStampSettingsPage from "./pages/FiscalStampSettingsPage";
import ClientsPage from "./pages/ClientsPage";
import CalendarPage from "./pages/CalendarPage";
import BillingPage from "./pages/BillingPage";
import SettingsLayout from "./pages/settings/SettingsLayout";
import ProfessionalsPage from "./pages/ProfessionalsPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/design-system" element={<DesignSystemShowcasePage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/app/calendar" element={<CalendarPage />} />
        <Route path="/app/services" element={<ServicesPage />} />
        <Route path="/app/billing" element={<BillingPage />} />
        <Route path="/app/clients" element={<ClientsPage />} />
        <Route path="/app/professionals" element={<ProfessionalsPage />} />
        <Route path="/app/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="business" replace />} />
          <Route path="business" element={<BusinessSettingsPage />} />
          <Route path="fiscal-stamp" element={<FiscalStampSettingsPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
