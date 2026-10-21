import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  message: string;
  onRetry: () => void;
  compact?: boolean;
};

export function QueryLoadError({ title, message, onRetry, compact = false }: Props) {
  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      {title ? (
        compact ? (
          <h3 className="font-display text-lg font-bold tracking-wider">{title}</h3>
        ) : (
          <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">{title}</h1>
        )
      ) : null}
      <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive sm:flex-row sm:items-center">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <p className="text-sm flex-1">{message}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
