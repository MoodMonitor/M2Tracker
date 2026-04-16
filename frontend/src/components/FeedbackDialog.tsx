import React, { useRef, useState, useEffect } from 'react'
import { MessageSquare, Send, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFeedback } from '@/context/FeedbackContext';
import { sendFeedback } from '@/services/apiService';
import type { FeedbackCategory } from '@/types/api';
import TurnstileWidget, { TurnstileWidgetHandle } from '@/components/TurnstileWidget'

/**
 * A dialog for users to submit general feedback, suggestions, or report non-critical issues.
 * Triggered globally via FeedbackContext.
 */
export const FeedbackDialog: React.FC = () => {
  const { isFeedbackOpen, closeFeedbackDialog } = useFeedback();
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [problemType, setProblemType] = useState<FeedbackCategory>('suggestion');
  const [needVerification, setNeedVerification] = useState(false)
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null)
  const pendingVerifyResolveRef = useRef<((token: string) => void) | null>(null)
  const tokenRef = useRef<string | null>(null)
  const { toast } = useToast()

  useEffect(() => { tokenRef.current = turnstileToken }, [turnstileToken])

  // Reset state when dialog is closed
  useEffect(() => { if (!isFeedbackOpen) { setComment(''); setProblemType('suggestion'); setTurnstileToken(null); setNeedVerification(false); } }, [isFeedbackOpen]);

  const requireTurnstile = import.meta.env.PROD || import.meta.env.DEV

  const ensureTurnstileToken = async (): Promise<string | null> => {
    if (!requireTurnstile) return null
    if (tokenRef.current) return tokenRef.current

    setNeedVerification(true)
    await new Promise(res => setTimeout(res, 0))

    // Wait up to ~5s for the widget to become ready
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      if (turnstileRef.current && turnstileRef.current.isReady) {
        break;
      }
      await new Promise(res => setTimeout(res, 250));
    }


    try {
      const token = await new Promise<string>((resolve, reject) => {
        pendingVerifyResolveRef.current = (t: string) => resolve(t)
        setTimeout(() => reject(new Error('Turnstile timeout')), 25000)
      })
      pendingVerifyResolveRef.current = null
      return token
    } catch {
      pendingVerifyResolveRef.current = null
      return null
    }
  }

  const handleSubmit = async () => {
    if (comment.trim().length < 10) {
      toast({ title: 'Wiadomość jest zbyt krótka', description: 'Prosimy, opisz swój problem lub sugestię bardziej szczegółowo.', variant: 'destructive' });
      return;
    }

    if (submitting) return
    setSubmitting(true)
    try {
      let token = turnstileToken
      if (requireTurnstile && !token) {
        token = await ensureTurnstileToken()
        if (!token) {
          toast({ title: 'Weryfikacja wymagana', description: 'Nie udało się uzyskać tokenu Turnstile. Spróbuj ponownie.', variant: 'destructive' as any })
          return
        }
        setTurnstileToken(token)
      }

      const res = await sendFeedback({
        category: problemType,
        comment: comment,
        turnstileToken: token!,
      });

      if (res?.success) {
        toast({
          title: 'Dziękujemy!',
          description: 'Twoja wiadomość została wysłana.'
        })
        setComment('')
        setProblemType('suggestion')
        closeFeedbackDialog();
        setTurnstileToken(null)
        setNeedVerification(false)
      } else {
        toast({ title: 'Nie udało się wysłać', description: 'Wystąpił problem podczas wysyłania zgłoszenia.', variant: 'destructive' as any })
      }
    } catch {
      toast({ title: 'Nie udało się wysłać', description: 'Wystąpił błąd podczas wysyłania zgłoszenia.', variant: 'destructive' as any })
    } finally {
      setSubmitting(false)
    }
  }

  return (
      <Dialog open={isFeedbackOpen} onOpenChange={(v) => { if (!v) closeFeedbackDialog(); }}>
        <DialogContent className="sm:max-w-[720px] bg-[#0B1119]/95 border border-white/10 shadow-2xl backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Formularz kontaktowy
            </DialogTitle>
            <DialogDescription>
              Masz sugestię, pomysł, albo chcesz zgłosić problem? Daj nam znać.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 grid grid-cols-1 gap-3">
            <div className="space-y-2">
              <label htmlFor="problem-type" className="text-sm font-medium">Kategoria</label>
              <Select value={problemType} onValueChange={(v) => setProblemType(v as any)}>
                <SelectTrigger id="problem-type" className="w-full">
                  <SelectValue placeholder="Wybierz kategorię..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="suggestion">Sugestia / Pomysł</SelectItem>
                  <SelectItem value="ux">Opinia o wyglądzie (UX/UI)</SelectItem>
                  <SelectItem value="content">Błąd w treści / danych</SelectItem>
                  <SelectItem value="other">Inne</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor="error-comment" className="text-sm font-medium">Twoja wiadomość</label>
              <textarea
                id="error-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full h-28 p-2 rounded-md border bg-background text-foreground"
                placeholder="Opisz swoją sugestię lub problem... (min. 10 znaków)"
              />
            </div>


          </div>

          {needVerification && (
            <div style={{ position: 'absolute'}}>
              <TurnstileWidget
                ref={turnstileRef}
                onVerify={(token) => { setTurnstileToken(token); pendingVerifyResolveRef.current?.(token); }}
                onError={() => { /* leave token null and let timeout handle */ }}
                action="manual_report"
                appearance="interaction-only"
                size="normal"
                variant='invisible'
              />
            </div>
          )}


          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={closeFeedbackDialog} disabled={submitting} className="flex-1">
              <X className="mr-2 h-4 w-4" /> Zamknij
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              <Send className="mr-2 h-4 w-4" /> Wyślij
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  )
}
