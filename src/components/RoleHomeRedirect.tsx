import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getHomePath } from "@/lib/access";

export function RoleHomeRedirect() {
  const { loading, roles } = useAuth();
  if (loading) return null;
  return <Navigate to={getHomePath(roles)} replace />;
}
