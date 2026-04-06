import { Navigate, useLocation } from "react-router-dom";
import { ACCESS_TOKEN_STORAGE_KEY } from "../api/baseUrl";

type Props = { children: React.ReactNode };

export function ProtectedRoute({ children }: Props) {
  const location = useLocation();
  const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
