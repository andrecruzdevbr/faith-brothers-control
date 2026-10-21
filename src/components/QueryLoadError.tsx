import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  message: string;
  onRetry: () => void;
};

export function QueryLoadError({ title, message, onRetry }: Props) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-display font-bold tracking-wider">{title}</h1>
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
