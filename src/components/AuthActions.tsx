import { LogOut, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export function AuthActions() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="ml-auto flex items-center gap-3">
      <div className="hidden items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 sm:flex">
        <Shield className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium uppercase tracking-wide text-foreground">
          {user?.roles.join(" · ") ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground">{user?.nome}</span>
      </div>
      <Button variant="ghost" size="sm" onClick={handleSignOut}>
        <LogOut className="h-4 w-4" />
        Sair
      </Button>
    </div>
  );
}
