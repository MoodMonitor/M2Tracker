import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Server } from "@/types/content";
import { ExternalLink, Clock } from "lucide-react";

interface ServerCardProps {
  server: Server;
  onClick: () => void;
}

export function ServerCard({ server, onClick }: ServerCardProps) {
  const difficultyVariant = `server-${server.difficulty}` as const;
  const difficultyText = {
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard'
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString();
  const relativeLabel = (human?: string) => human || "—";

  return (
    <Card className="group cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.02] bg-[#0B1119] hover:bg-[#0D141F] border border-[#141B24]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors">
              {server.name}
            </h3>
            <Badge variant={difficultyVariant}>
              {difficultyText[server.difficulty]}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {server.status === 'active' ? (
              <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
            ) : (
              <div className="w-2 h-2 bg-muted-foreground rounded-full" />
            )}
            <span className="text-xs text-muted-foreground">
              {server.status === 'active' ? 'Aktywny' : 'Zatrzymany'}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span>
            <span className="text-muted-foreground">Utworzony:</span>{" "}
            <span className="font-medium text-foreground">{formatDate(server.createdAt)}</span>
          </span>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <div className="flex flex-col leading-tight">
              <span className="text-xs text-muted-foreground">Ostatnia aktualizacja</span>
              <span className="text-sm font-medium">{relativeLabel(server.lastUpdatedHuman)}</span>
            </div>
          </div>
          <Button onClick={onClick} size="sm" className="gap-2">
            Zobacz Dashboard
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}