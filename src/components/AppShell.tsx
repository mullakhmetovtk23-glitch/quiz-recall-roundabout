import { Link } from "@tanstack/react-router";
import { BarChart3, BookOpen, Download, Layers } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Тренировка", icon: Layers },
  { to: "/library", label: "База", icon: BookOpen },
  { to: "/import", label: "Импорт", icon: Download },
  { to: "/settings", label: "Статистика", icon: BarChart3 },
] as const;

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-primary font-display text-sm font-bold text-primary-foreground shadow-card">
        Б
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold">Бинго-тренер</div>
        <div className="text-[11px] text-muted-foreground">факты для ЧГК и Своей игры</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 border-r border-sidebar-border bg-sidebar px-5 py-6 md:flex">
        <Logo />
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground"
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1.5 text-xs text-muted-foreground">
          <div className="font-medium text-foreground/70">Горячие клавиши</div>
          <div><span className="kbd">Space</span> перевернуть</div>
          <div><span className="kbd">1</span>–<span className="kbd">4</span> оценка</div>
          <div><span className="kbd">E</span> редактировать</div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
      </header>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground data-[status=active]:text-primary"
            >
              <Icon className="size-6" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
