import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import DesignSystemShowcasePage from "./pages/DesignSystemShowcasePage";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LoginPage from "./pages/LoginPage";
import PlaceholderPage from "./pages/PlaceholderPage";

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
        <Route path="/app/calendar" element={<PlaceholderPage />} />
        <Route path="/app/services" element={<PlaceholderPage />} />
        <Route path="/app/professionals" element={<PlaceholderPage />} />
        <Route path="/app/clients" element={<PlaceholderPage />} />
        <Route path="/app/billing" element={<PlaceholderPage />} />
        <Route path="/app/settings" element={<PlaceholderPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
