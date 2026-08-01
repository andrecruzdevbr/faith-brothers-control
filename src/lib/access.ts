import type { AppRole } from "@/lib/constants";
import {
  ACADEMY_LIMITED_PATHS,
  ADMIN_ONLY_PATHS,
  STAFF_FULL_PATHS,
} from "@/lib/constants";

export function hasRole(roles: AppRole[], role: AppRole): boolean {
  return roles.includes(role);
}

export function isAdminRole(roles: AppRole[]): boolean {
  return hasRole(roles, "admin");
}

export function isProfessorRole(roles: AppRole[]): boolean {
  return hasRole(roles, "professor");
}

export function isAcademyLimitedRole(roles: AppRole[]): boolean {
  return hasRole(roles, "academy_limited") && !isAdminRole(roles) && !isProfessorRole(roles);
}

/** Admin ou professor (staff tradicional). */
export function isStaffRole(roles: AppRole[]): boolean {
  return isAdminRole(roles) || isProfessorRole(roles);
}

/** Usa shell do painel (staff ou academy_limited). */
export function isPanelUserRole(roles: AppRole[]): boolean {
  return isStaffRole(roles) || hasRole(roles, "academy_limited");
}

export function isAlunoRole(roles: AppRole[]): boolean {
  return hasRole(roles, "aluno") && !isPanelUserRole(roles);
}

export function getHomePath(roles: AppRole[]): string {
  if (isAcademyLimitedRole(roles)) return "/turmas";
  if (isStaffRole(roles)) return "/dashboard";
  return "/minha-presenca";
}

export function canAccessPath(roles: AppRole[], pathname: string): boolean {
  const path = pathname.split("?")[0] || pathname;

  if (ADMIN_ONLY_PATHS.includes(path as (typeof ADMIN_ONLY_PATHS)[number])) {
    if (path === "/configuracoes") {
      return isAdminRole(roles) || isAcademyLimitedRole(roles);
    }
    return isAdminRole(roles);
  }

  if ((ACADEMY_LIMITED_PATHS as readonly string[]).includes(path)) {
    return isStaffRole(roles) || isAcademyLimitedRole(roles);
  }

  if ((STAFF_FULL_PATHS as readonly string[]).includes(path)) {
    return isStaffRole(roles);
  }

  if (path.startsWith("/minha-") || path.startsWith("/meu-")) {
    return isAlunoRole(roles);
  }

  return false;
}
