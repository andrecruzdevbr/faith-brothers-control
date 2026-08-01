import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { RoleHomeRedirect } from "@/components/RoleHomeRedirect";
import { Skeleton } from "@/components/ui/skeleton";

const Login = lazy(() => import("./pages/Login"));
const Cadastro = lazy(() => import("./pages/Cadastro"));
const RecuperarSenha = lazy(() => import("./pages/RecuperarSenha"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Alunos = lazy(() => import("./pages/Alunos"));
const Turmas = lazy(() => import("./pages/Turmas"));
const Presencas = lazy(() => import("./pages/Presencas"));
const Graduacao = lazy(() => import("./pages/Graduacao"));
const Financeiro = lazy(() => import("./pages/Financeiro"));
const Ranking = lazy(() => import("./pages/Ranking"));
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Professores = lazy(() => import("./pages/Professores"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const MinhaPresenca = lazy(() => import("./pages/MinhaPresenca"));
const MinhaGraduacao = lazy(() => import("./pages/MinhaGraduacao"));
const MeuFinanceiro = lazy(() => import("./pages/MeuFinanceiro"));
const MeuPerfil = lazy(() => import("./pages/MeuPerfil"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function PageLoader() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/recuperar-senha" element={<RecuperarSenha />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<RoleHomeRedirect />} />
              </Route>

              <Route element={<ProtectedRoute access="staff" />}>
                <Route element={<Layout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/alunos" element={<Alunos />} />
                  <Route path="/relatorios" element={<Relatorios />} />
                </Route>
              </Route>

              <Route element={<ProtectedRoute access="ops" />}>
                <Route element={<Layout />}>
                  <Route path="/turmas" element={<Turmas />} />
                  <Route path="/presencas" element={<Presencas />} />
                  <Route path="/graduacao" element={<Graduacao />} />
                  <Route path="/ranking" element={<Ranking />} />
                </Route>
              </Route>

              <Route element={<ProtectedRoute access="admin" />}>
                <Route element={<Layout />}>
                  <Route path="/financeiro" element={<Financeiro />} />
                  <Route path="/professores" element={<Professores />} />
                </Route>
              </Route>

              <Route element={<ProtectedRoute access="settings" />}>
                <Route element={<Layout />}>
                  <Route path="/configuracoes" element={<Configuracoes />} />
                </Route>
              </Route>

              <Route element={<ProtectedRoute access="aluno" />}>
                <Route element={<Layout />}>
                  <Route path="/minha-presenca" element={<MinhaPresenca />} />
                  <Route path="/minha-graduacao" element={<MinhaGraduacao />} />
                  <Route path="/meu-ranking" element={<Ranking />} />
                  <Route path="/meu-financeiro" element={<MeuFinanceiro />} />
                  <Route path="/meu-perfil" element={<MeuPerfil />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
