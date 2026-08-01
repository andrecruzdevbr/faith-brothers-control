import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getHomePath } from "@/lib/access";
import type { AppRole } from "@/lib/constants";

interface ProtectedRouteProps {
  /**
   * admin = somente admin
   * staff = admin ou professor (não academy_limited)
   * ops = staff ou academy_limited (turmas/presenças/graduação/ranking)
   * settings = admin ou academy_limited (config básica)
   * aluno = somente aluno
   */
  access?: "admin" | "staff" | "ops" | "settings" | "aluno";
}

export function ProtectedRoute({ access }: ProtectedRouteProps) {
  const { isAuthenticated, loading, isAdmin, isStaff, isAluno, isAcademyLimited, roles } = useAuth();
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

  const home = getHomePath(roles);

  if (access === "admin" && !isAdmin) {
    return <Navigate to={home} replace />;
  }

  if (access === "staff" && !isStaff) {
    return <Navigate to={home} replace />;
  }

  if (access === "ops" && !(isStaff || isAcademyLimited)) {
    return <Navigate to={home} replace />;
  }

  if (access === "settings" && !(isAdmin || isAcademyLimited)) {
    return <Navigate to={home} replace />;
  }

  if (access === "aluno" && !isAluno) {
    return <Navigate to={home} replace />;
  }

  return <Outlet />;
}

export type { AppRole };
