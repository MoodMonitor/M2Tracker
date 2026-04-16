import { createContext, useEffect, ReactNode } from 'react';
import { Send } from 'lucide-react';
import { eventBus } from '@/lib/eventBus';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { errorReporter } from '@/lib/errorReporter';

interface GlobalErrorState {
  rateLimitError: string | null;
}

const GlobalErrorContext = createContext<GlobalErrorState>({
  rateLimitError: null,
});

export function GlobalErrorProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  useEffect(() => {
    const handleApiError = (data: { status: number; message: string, errorPayload?: any }) => {
      if (data.status === 429) {
        console.warn(`[GlobalErrorHandler] Rate limit hit: ${data.message}`);
        toast({
          variant: "default",
          title: "Ograniczenie liczby żądań",
          description: "Wykryto zbyt wiele żądań. Prosimy spróbować ponownie za chwilę.",
          duration: 5000,
        });
      }

      // Handle non-critical server errors (5xx)
      if (data.status >= 500 && data.status < 600) {
        console.warn(`[GlobalErrorHandler] Non-critical server error: ${data.status}`);
        toast({
          variant: "default",
          title: "Problem z serwerem",
          description: "Wystąpił przejściowy problem z komunikacją. Niektóre dane mogą być nieaktualne.",
          duration: 5000,
        });
      }
    };
    const unsubscribe = eventBus.on('api:error', handleApiError);

    return () => {
      unsubscribe();
    };
  }, [toast]);

  return (
    <GlobalErrorContext.Provider value={{ rateLimitError: null }}>
      {children}
    </GlobalErrorContext.Provider>
  );
}

export default GlobalErrorContext;