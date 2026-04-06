import { Navigate, useParams } from "react-router-dom";
import { Spinner } from "@design-system";
import { useMe } from "../hooks/useMe";

type Props = { children: React.ReactNode };

/**
 * Ensures the URL tenant id matches an active tenant-admin assignment for the current user.
 */
export function TenantAdminRoute({ children }: Props) {
  const { tenantId: tenantIdParam } = useParams();
  const { me, loading } = useMe();
  const tenantId = tenantIdParam ? parseInt(tenantIdParam, 10) : NaN;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!me || Number.isNaN(tenantId)) {
    return <Navigate to="/" replace />;
  }

  const tenants = me.tenantAdminTenants ?? [];
  const allowed = tenants.some((t) => t.tenantId === tenantId);
  if (!allowed) {
    const first = tenants[0];
    return <Navigate to={first ? `/tenant-admin/${first.tenantId}` : "/"} replace />;
  }

  return <>{children}</>;
}
