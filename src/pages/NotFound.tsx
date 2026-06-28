import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404: rota inexistente:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <p className="font-display text-8xl font-bold text-primary tracking-wider">404</p>
        <h1 className="mt-4 text-2xl font-display font-bold tracking-wider text-foreground">
          PÁGINA NÃO ENCONTRADA
        </h1>
        <p className="mt-3 text-muted-foreground">
          A rota <span className="text-foreground font-mono text-sm">{location.pathname}</span> não existe ou foi
          movida.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild variant="default" className="gradient-primary text-primary-foreground gap-2">
            <Link to="/">
              <Home className="h-4 w-4" />
              Ir para o início
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2 border-border">
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              Voltar ao login
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
