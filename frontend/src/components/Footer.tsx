import { Link } from "react-router-dom";
import { useFeedback } from "@/context/FeedbackContext";
import { DevErrorTrigger } from "@/components/DevErrorTrigger";
import { MessageSquare, Mail } from "lucide-react";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-semibold text-foreground mb-3 relative inline-block">
      <span className="relative z-10">{children}</span>
      <span className="block h-[2px] w-12 bg-[hsl(45_70%_60%)] mt-1 shadow-[0_0_8px_hsl(45_70%_60%_/_0.6)]" />
    </h3>
  );
}

export default function Footer() {
  const { openFeedbackDialog } = useFeedback();
  const isDemoMsw = import.meta.env.DEV && import.meta.env.VITE_MSW_ENABLED === 'true';

  return (
    <footer id="footer" className="border-t border-white/10 bg-black">
      <div className="container mx-auto px-4 pt-12 pb-8 text-sm text-muted-foreground">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <SectionHeading>O serwisie M2Tracker</SectionHeading>
            <ul className="space-y-2 leading-relaxed">
              <li>
                M2Tracker to niezależna platforma analityczna prezentująca dane dotyczące prywatnych serwerów Metin2, pozyskiwane z ogólnodostępnych źródeł.
              </li>
              <li>
                Serwis ma charakter statystyczno-informacyjny i nie jest powiązany z oficjalnym Metin2 ani żadnym serwerem prywatnym.
              </li>
            </ul>
          </div>

          <div>
            <SectionHeading>Zastrzeżenia prawne</SectionHeading>
            <ul className="space-y-2 leading-relaxed">
              <li>
                Wszystkie prezentowane dane (w tym ceny i przedmioty) mają charakter informacyjny i mogą nie odzwierciedlać stanu faktycznego. Interpretacja danych należy do użytkownika.
              </li>
              <li>
                Nazwy, logotypy i materiały są własnością odpowiednich właścicieli. Serwis jedynie agreguje i analizuje dane pochodzące ze źródeł dostępnych powszechnie, nie roszcząc sobie do nich żadnych praw.
              </li>
              <li>
                Strona udostępniana jest w formie „as is” – bez jakiejkolwiek gwarancji dokładności, aktualności czy dostępności.
              </li>
            </ul>
          </div>

          <div>
            <SectionHeading>Kontakt</SectionHeading>
            <ul className="space-y-2 leading-relaxed">
              <li>
                <a href="mailto:contact@m2tracker.app" className="flex items-center gap-2 text-primary hover:underline">
                  <Mail className="h-4 w-4" /> contact@m2tracker.app
                </a>
              </li>
              <li>
                <button onClick={openFeedbackDialog} className="flex items-center gap-2 text-primary hover:underline">
                  <MessageSquare className="h-4 w-4" /> Formularz kontaktowy
                </button>
              </li>
            </ul>
          </div>
        </div>

        {import.meta.env.DEV && (
          <div className="mt-10 pt-6 border-t border-destructive/20 text-center">
            <h4 className="text-sm font-semibold text-destructive/80 mb-3">Panel Deweloperski</h4>
            {isDemoMsw && (
              <div className="mb-3 inline-flex items-center rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                TRYB DEMO (MSW) - dane mockowane
              </div>
            )}
            <DevErrorTrigger />
          </div>
        )}
      </div>
    </footer>
  );
}
