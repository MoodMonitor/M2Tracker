import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ServerCandidate } from "@/types/content";
import { Vote, Megaphone, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox"; 
import { useState, useEffect, useMemo, useRef } from "react";
import { voteServers } from "@/services/apiService";
import { HttpError } from "@/services/httpError.ts";
import TurnstileWidget, { TurnstileWidgetHandle } from "@/components/TurnstileWidget.tsx";
import type { VoteRequest } from "@/types/api";

interface VotingSectionProps {
  candidates: ServerCandidate[];
}

export function VotingSection({ candidates: initialCandidates }: VotingSectionProps) {
  const { toast } = useToast();

  const [candidates, setCandidates] = useState<ServerCandidate[]>(initialCandidates);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [lockUntil, setLockUntil] = useState<number>(0);
  const [hoverVote, setHoverVote] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const votePayloadRef = useRef<Omit<VoteRequest, 'turnstile_token'> | null>(null);

  useEffect(() => {
    setCandidates(initialCandidates);
  }, [initialCandidates]);

  // Initialize client-side 24h lock from localStorage
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('vote_lock_until') : null;
      const ts = raw ? parseInt(raw, 10) : 0;
      if (!Number.isNaN(ts)) setLockUntil(ts);
    } catch {
      // no-op
    }
  }, []);

  const locked = lockUntil > Date.now();

  const setClientVoteLock = (durationMs: number) => {
    try {
      const until = Date.now() + durationMs;
      localStorage.setItem('vote_lock_until', String(until));
      setLockUntil(until);
    } catch {
      // ignore if localStorage is unavailable
    }
  };

  const toggle = (id: string, next?: boolean | "indeterminate") => {
    setSelected((prev) => {
      const s = new Set(prev);
      const shouldAdd = typeof next === "boolean" ? next : !s.has(id);
      if (shouldAdd) s.add(id); else s.delete(id);
      return s;
    });
  };

  const handleSubmit = () => {
    if (selected.size === 0 || submitting) return;
    if (locked) {
      const retryMs = Math.max(0, lockUntil - Date.now());
      const minutes = Math.ceil(retryMs / 60000);
      toast({
        title: "Już głosowano",
        description: `Możesz zagłosować ponownie za około ${minutes} min.`,
      });
      return;
    }
    
    setSubmitting(true);
    votePayloadRef.current = { servers: Array.from(selected) };
    setNeedsVerification(true);
  };

  const handleVoteVerified = async (token: string) => {
    if (!votePayloadRef.current) {
      setSubmitting(false);
      return;
    }
    
    try {
      const res = await voteServers({ ...votePayloadRef.current, turnstile_token: token });
      if (res.allowed) {
        toast({
          title: "Głosy zapisane!",
          description: `Oddano ${res.voted_count} głos(y). (Głos raz na 24h)`,
        });
        // Optimistic update for immediate feedback
        setCandidates(prevCandidates =>
          prevCandidates.map(c =>
            selected.has(c.id) ? { ...c, votes: c.votes + 1 } : c
          )
        );
        setSelected(new Set());
        setClientVoteLock(24 * 3600 * 1000);
      } else {
        const retry = Math.max(0, res.retry_after_seconds ?? 0);
        const minutes = Math.ceil(retry / 60);
        toast({
          title: "Odczekaj przed kolejnym głosowaniem",
          description: `Limit 24h aktywny. Spróbuj ponownie za około ${minutes} min.`,
        });
        // Respect server-provided retry window on client
        setClientVoteLock(retry * 1000);
      }
    } catch (e) {
      if (e instanceof HttpError && e.response.status === 429) {
        const retrySeconds = 300;
        setClientVoteLock(retrySeconds * 1000);
      } else {
        toast({
          title: "Błąd wysyłania głosu",
          description: e instanceof Error ? e.message : "Nie udało się wysłać głosów. Spróbuj ponownie.",
        });
      }
    } finally {
      setSubmitting(false);
      votePayloadRef.current = null;
      setNeedsVerification(false);
    }
  };

  const sortedCandidates = useMemo(() =>
    [...candidates].sort((a, b) => b.votes - a.votes),
    [candidates]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="mb-6 text-center flex-shrink-0">
        <h2 className="fantasy-heading fantasy-heading-medium text-[hsl(45_70%_60%)] mb-2 hover:text-[hsl(45_70%_70%)] transition-all duration-300 cursor-default hover:scale-105">Głosowanie na nowy serwer</h2>
        <div className="relative mx-auto">
          <div className="w-32 h-1 bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent mx-auto rounded-full shadow-[0_0_10px_hsl(45_70%_60%_/_0.6)]"></div>
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-1 bg-[hsl(45_70%_60%)] rounded-full shadow-[0_0_8px_hsl(45_70%_60%_/_0.8)]"></div>
        </div>
      </div>

      <div className="bg-[#0B1119] border-[35px] border-transparent rounded-lg shadow-lg flex flex-col overflow-hidden" style={{
        borderImageSource: 'url(/img/frame.png)',
        borderImageSlice: '100 fill',
        borderImageWidth: '35px',
        borderImageOutset: '0',
        borderImageRepeat: 'stretch',
        height: '480px'
      }}>
        <div className="p-6 flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar">
            {sortedCandidates.map((candidate, index) => (
              <div
                key={candidate.id}
                className="group flex items-center justify-between p-4 rounded-lg bg-[#090D15] border border-[#141B24] transition-all duration-300 focus-within:ring-2 focus-within:ring-[hsl(45_70%_60%_/_0.35)]"
              >
                <div className="flex items-center gap-3">
                  {index === 0 && (
                    <TrendingUp className="h-4 w-4 text-[hsl(45_70%_60%)]" />
                  )}
                  <div>
                    <h4 className="font-semibold text-sm text-white transition-colors">
                      <span className="group-hover:text-[hsl(45_70%_60%)] group-hover:underline underline-offset-2">
                        {candidate.name}
                      </span>
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="gap-1 border-[#141B24] text-gray-300">
                    <Vote className="h-3 w-3" />
                    {candidate.votes}
                  </Badge>
                  <Checkbox
                    checked={selected.has(candidate.id)}
                    onCheckedChange={(checked) => toggle(candidate.id, checked)}
                    aria-label={`Wybierz ${candidate.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-lg bg-[#090D15] border border-[#141B24] flex-shrink-0 mt-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <Megaphone className="h-6 w-6 text-[hsl(45_85%_72%)] mt-0 drop-shadow-[0_0_10px_hsl(45_70%_60%_/_0.7)]" />
                <div className="text-sm text-gray-200 leading-snug">
                  <p><span className="font-semibold">Wielokrotny wybór</span> - zatwierdź przyciskiem. Głosować można raz na 24 godziny.</p>
                  <p>Propozycje serwerów proszę przesyłać na maila.</p>
                </div>
              </div>
              <div
                className="flex items-center gap-3"
                onMouseEnter={() => setHoverVote(true)}
                onMouseLeave={() => setHoverVote(false)}
              >
                <Button
                  size="lg"
                  onClick={handleSubmit}
                  disabled={selected.size === 0 || submitting || locked}
                  className="w-[170px]"
                  title={locked ? "Zagłosowano już" : undefined}
                >
                  <Vote className="h-4 w-4 mr-1" />
                  {submitting ? "Wysyłanie..." : locked && hoverVote ? "Zagłosowano już" : "Zagłosuj"}
                </Button>
              </div>
            </div>
          </div>
        </div>
        </div>
        {needsVerification && (
          <div className="absolute -z-10 opacity-0">
          <TurnstileWidget
            ref={turnstileRef}
            onVerify={handleVoteVerified}
            onError={() => { setSubmitting(false); setNeedsVerification(false); toast({ title: "Błąd weryfikacji", description: "Nie można zweryfikować Twojej sesji. Spróbuj odświeżyć stronę.", variant: "destructive" }); }}
            action="homepage_vote"
            variant="invisible"
            appearance="interaction-only"
          />
        </div>)}
      </div>
    </div>
  );
}
export default VotingSection;