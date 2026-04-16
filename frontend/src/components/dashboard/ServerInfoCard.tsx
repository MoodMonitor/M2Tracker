import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link as LinkIcon, Calendar, Clock, Coins } from "lucide-react";
import type { Server } from "@/types/content";
import type { DashboardServerInfo } from "@/types/api";
import { safeExternalUrl} from "@/lib/utils";

interface Props {
  server: Server;
  info?: DashboardServerInfo; // optional, from init API
}

export function ServerInfoCard({ server, info }: Props) {
  const createdAt = info?.created_at
    ? new Date(info.created_at).toLocaleDateString("pl-PL")
    : new Date(server.createdAt).toLocaleDateString("pl-PL");

  const lastUpdated = (() => {
    if (info?.last_data_update) {
      const raw = info.last_data_update;
      const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? raw : d.toLocaleString("pl-PL");
    }
    return new Date(server.lastUpdated).toLocaleString("pl-PL");
  })();

  return (
    <Card className="relative bg-[#0B1119] hover:bg-[#0D141F] border border-[#141B24] backdrop-blur-sm animate-fade-in transition-colors">
      <div className="pointer-events-none absolute -top-px left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent opacity-60" />
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <CardTitle className="fantasy-heading fantasy-heading-large text-[hsl(45_70%_60%)]">
          {server.name}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize">{server.difficulty}</Badge>
          <Badge variant={server.status === 'active' ? 'default' : 'secondary'}>
            {server.status === 'active' ? 'Aktywny' : 'Wstrzymany'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-full lg:max-w-5xl">
          {info?.description ?? (
            `${server.name} – szybki podgląd najważniejszych informacji rynkowych serwera. Poniżej znajdziesz szybkie statystyki 24h, wykresy sklepów i ilości przedmiotów, dane historyczne oraz kalkulator cen.`
          )}
        </p>

        {info?.currencies && info.currencies.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-[#0B1119]/60 border border-[#1b2635] text-xs">
              <Coins className="h-4 w-4 text-slate-400" />
              <span className="text-muted-foreground">Waluty:</span>
              {info.currencies.map(c => (
                <span key={c.symbol} className="font-semibold text-slate-200">1 {c.symbol} = {c.threshold.toLocaleString('pl-PL')} Yang</span>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-[#0B1119]/60 border border-[#1b2635] text-xs">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span className="text-muted-foreground">Utworzony:</span>
            <span className="font-semibold text-slate-200">{createdAt}</span>
          </div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-[#0B1119]/60 border border-[#1b2635] text-xs">
            <Clock className="h-4 w-4 text-slate-400" />
            <span className="text-muted-foreground">Ostatnia aktualizacja:</span>
            <span className="font-semibold text-slate-200">{lastUpdated}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {(info?.website_url || server.links.website) && (
            <a
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#1b2635] hover:border-[hsl(45_70%_60%_/_0.35)] text-[hsl(45_70%_60%)] hover:text-[hsl(45_70%_70%)] bg-[#0B1119]/50 transition-colors"
              href={safeExternalUrl(info?.website_url ?? server.links.website!)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <LinkIcon className="h-4 w-4" /> Oficjalna strona
            </a>
          )}
          {(info?.forum_url || server.links.forum) && (
            <a
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#1b2635] hover:border-[hsl(45_70%_60%_/_0.35)] text-[hsl(45_70%_60%)] hover:text-[hsl(45_70%_70%)] bg-[#0B1119]/50 transition-colors"
              href={safeExternalUrl(info?.forum_url ?? server.links.forum!)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Forum
            </a>
          )}
          {(info?.discord_url || server.links.discord) && (
            <a
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#1b2635] hover:border-[hsl(45_70%_60%_/_0.35)] text-[hsl(45_70%_60%)] hover:text-[hsl(45_70%_70%)] bg-[#0B1119]/50 transition-colors"
              href={safeExternalUrl(info?.discord_url ?? server.links.discord!)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Discord
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
