import { Navigate, useLocation } from "react-router-dom";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";
import { getSharedDevice, SHARED_DEVICE_PATH } from "./sharedDevice";

type Props = { children: React.ReactNode };

export function ProtectedRoute({ children }: Props) {
  const location = useLocation();
  const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (!token) {
    // HU-66: a shared device goes back to its professional picker, not the login form.
    if (getSharedDevice()) {
      return <Navigate to={SHARED_DEVICE_PATH} replace />;
    }
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
