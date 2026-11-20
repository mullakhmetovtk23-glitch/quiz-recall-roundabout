import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function OptionCard({
  active,
  onClick,
  title,
  description,
  icon,
  role = "radio",
}: {
  active: boolean;
  onClick: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  role?: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-all active:scale-[0.99]",
        active ? "border-primary bg-accent text-accent-foreground shadow-card" : "border-border hover:bg-secondary",
      )}
    >
      {icon && <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center border-2",
          role === "radio" ? "rounded-full" : "rounded-md",
          active ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground" style={{ fontFamily: "var(--font-sans)" }}>
        {children}
      </h2>
      {aside}
    </div>
  );
}
