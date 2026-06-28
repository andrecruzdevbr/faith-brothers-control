import {
  LayoutDashboard, Users, CalendarDays, ClipboardCheck, Award, DollarSign,
  Trophy, BarChart3, GraduationCap, Settings, UserCircle,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

const staffMenuItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Alunos", url: "/alunos", icon: Users },
  { title: "Turmas", url: "/turmas", icon: CalendarDays },
  { title: "Presenças", url: "/presencas", icon: ClipboardCheck },
  { title: "Graduação", url: "/graduacao", icon: Award },
  { title: "Ranking", url: "/ranking", icon: Trophy },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
];

const adminOnlyMenuItems = [
  { title: "Financeiro", url: "/financeiro", icon: DollarSign },
  { title: "Professores", url: "/professores", icon: GraduationCap },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
];

const alunoMenuItems = [
  { title: "Minhas Presenças", url: "/minha-presenca", icon: ClipboardCheck },
  { title: "Minha Graduação", url: "/minha-graduacao", icon: Award },
  { title: "Meu Ranking", url: "/meu-ranking", icon: Trophy },
  { title: "Meus Pagamentos", url: "/meu-financeiro", icon: DollarSign },
  { title: "Meu Perfil", url: "/meu-perfil", icon: UserCircle },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isStaff, isAdmin } = useAuth();

  const menuItems = isStaff
    ? [...staffMenuItems, ...(isAdmin ? adminOnlyMenuItems : [])]
    : alunoMenuItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
          <img src="/logo.svg" alt="Faith Brothers BJJ" className="w-10 h-10 rounded-full object-cover ring-2 ring-primary/30" />
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-display text-sm font-bold tracking-wider text-primary">FAITHBROTHERS</span>
              <span className="text-[10px] text-muted-foreground tracking-widest">CONTROL</span>
            </div>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${
                          isActive
                            ? "gradient-primary shadow-glow text-primary-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent"
                        }`}
                        activeClassName=""
                      >
                        <item.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && <span className="text-sm font-medium">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
