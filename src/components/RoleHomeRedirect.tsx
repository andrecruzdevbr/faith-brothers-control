import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function RoleHomeRedirect() {
  const { isStaff, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={isStaff ? "/dashboard" : "/minha-presenca"} replace />;
}
