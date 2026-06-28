import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { AppRole } from "@/lib/constants";

interface ProtectedRouteProps {
  /** admin = only admin role; staff = admin or professor; aluno = student only */
  access?: "admin" | "staff" | "aluno";
}

export function ProtectedRoute({ access }: ProtectedRouteProps) {
  const { isAuthenticated, loading, isAdmin, isStaff, isAluno } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="rounded-2xl border border-border bg-card px-6 py-5 shadow-card animate-pulse">
          <p className="font-display text-lg tracking-wide text-foreground">Carregando acesso...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (access === "admin" && !isAdmin) {
    return <Navigate to={isStaff ? "/dashboard" : "/minha-presenca"} replace />;
  }

  if (access === "staff" && !isStaff) {
    return <Navigate to="/minha-presenca" replace />;
  }

  if (access === "aluno" && !isAluno) {
    return <Navigate to={isAdmin ? "/dashboard" : isStaff ? "/dashboard" : "/minha-presenca"} replace />;
  }

  return <Outlet />;
}

export type { AppRole };
