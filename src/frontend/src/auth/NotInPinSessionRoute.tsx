import { Navigate, Outlet } from "react-router-dom";
import { isPinSession } from "./sharedDevice";

/**
 * HU-66: a PIN session on a shared device is calendar-only — screens a professional otherwise
 * reaches with email + password (e.g. "Mis comisiones") send her back to the calendar.
 */
export function NotInPinSessionRoute() {
  if (isPinSession()) {
    return <Navigate to="/app/calendar" replace />;
  }
  return <Outlet />;
}
