import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Home, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Server as ServerType } from "@/types/content";

interface DashboardNavProps {
  currentServerName?: string;
  otherServers?: string[]; // names
  servers: ServerType[]; // changed to required prop
}

export function DashboardNav({ currentServerName, otherServers, servers }: DashboardNavProps) {
  const navigate = useNavigate();
  const { serverId } = useParams<{ serverId: string }>();
  const sections = [
    { id: 'quick-stats', label: 'Statystyki 24h' },
    { id: 'market-activity', label: 'Aktywność rynkowa' },
    { id: 'items-no-bonus', label: 'Bez bonusów' },
    { id: 'items-with-bonus', label: 'Z bonusami' },
  ] as const;

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Fallback to hash navigation if element not found yet
      window.location.hash = `#${id}`;
    }
  };

  // Track the active section for nav highlight
  const [activeSection, setActiveSection] = useState<string>('quick-stats');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        // Highlight when section center approaches viewport center
        rootMargin: '-40% 0px -50% 0px',
        threshold: 0.1,
      }
    );
    const ids = ['quick-stats', 'market-activity', 'items-no-bonus', 'items-with-bonus'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 p-4 rounded-xl bg-[#0B1119]/75 border border-[#141B24] hover:border-[hsl(45_70%_60%_/_0.35)] shadow-lg shadow-[rgba(214,176,79,0.08)] backdrop-blur-md animate-fade-in transition-all">
      {/* Golden accent line */}
      <div className="pointer-events-none absolute -top-px left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent opacity-60" />
      <div className="flex items-center gap-3">
        <Link to="/" className="inline-flex items-center">
          <Button variant="outline" className="gap-2 hover:text-[hsl(45_70%_60%)] border-[#1b2635] bg-[#0B1119]/60">
            <Home className="h-4 w-4" />
            Strona główna
          </Button>
        </Link>
      </div>

      {/* In-page section navigation */}
      <nav className="flex flex-wrap items-center gap-2">
        {sections.map((s) => (
          <Button
            key={s.id}
            variant="ghost"
            className={`h-9 px-3 text-[0.92rem] tracking-wide rounded-lg border border-transparent hover:border-[hsl(45_70%_60%_/_0.35)] hover:bg-[hsl(215_30%_12%_/_0.6)] hover:text-[hsl(45_70%_60%)] ${
              activeSection === s.id
                ? 'bg-[hsl(45_70%_60%_/_0.12)] text-[hsl(45_70%_70%)] border-[hsl(45_70%_60%_/_0.35)] shadow-[0_0_12px_hsl(45_70%_60%_/_0.25)]'
                : 'text-slate-300'
            }`}
            onClick={() => scrollToSection(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </nav>

      <div className="w-full lg:w-[420px]">
        <div className="flex items-center gap-3 lg:justify-end">
          <div className="flex items-center gap-2 text-slate-400">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline hover:text-[hsl(45_70%_60%)] transition-colors">Przełącz serwer:</span>
          </div>
          <div className="min-w-[220px] flex-1">
            {(() => {
              // Prefer provided name list (current + others); fall back to all servers.
              // If a name has no matching server entry, create a minimal fallback option.
              const nameList: string[] | null = (currentServerName || (otherServers && otherServers.length))
                ? [
                    ...(currentServerName ? [currentServerName] : []),
                    ...((otherServers || []).filter(n => !currentServerName || n !== currentServerName))
                  ]
                : null;

              const options: { id: string; name: string }[] = nameList
                ? nameList.map((name) => {
                    const found = servers.find((s) => s.name === name);
                    return found ? { id: found.id, name: found.name } : { id: name, name };
                  })
                : servers.map((s) => ({ id: s.id, name: s.name }));

              return (
                <Select value={serverId} onValueChange={(val) => navigate(`/server/${encodeURIComponent(val)}`)}>
                  <SelectTrigger className="w-full bg-[#0B1119]/60 border-[#1b2635] focus:ring-1 focus:ring-[hsl(45_70%_60%_/_0.45)]">
                    <SelectValue placeholder="Wybierz serwer" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
