import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { FAQ } from "@/types/content";
import { HelpCircle } from "lucide-react";

interface FAQSectionProps {
  faqs: FAQ[];
}

export function FAQSection({ faqs }: FAQSectionProps) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="mb-6 text-center flex-shrink-0">
        <h2 className="fantasy-heading fantasy-heading-medium text-[hsl(45_70%_60%)] mb-2 hover:text-[hsl(45_70%_70%)] transition-all duration-300 cursor-default hover:scale-105 flex items-center justify-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Najczęstsze pytania (FAQ)
        </h2>
        <div className="relative mx-auto">
          <div className="w-32 h-1 bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent mx-auto rounded-full shadow-[0_0_10px_hsl(45_70%_60%_/_0.6)]"></div>
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-1 bg-[hsl(45_70%_60%)] rounded-full shadow-[0_0_8px_hsl(45_70%_60%_/_0.8)]"></div>
        </div>
      </div>

      <div
        className="bg-[#0B1119] border-[35px] border-transparent rounded-lg shadow-lg flex flex-col"
        style={{
          borderImageSource: 'url(/img/frame.png)',
          borderImageSlice: '100 fill',
          borderImageWidth: '35px',
          borderImageOutset: '0',
          borderImageRepeat: 'stretch',
        }}
      >
        <div className="p-6 flex-1 flex flex-col">
          <div>
            <Accordion type="single" collapsible className="w-full space-y-3">
              {faqs.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id} className="group">
                  <AccordionTrigger className="no-underline hover:no-underline focus:no-underline active:no-underline text-left rounded-lg bg-[#090D15] border border-[#141B24] px-4 py-3 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(45_70%_60%_/_0.35)]">
                    <span className="no-underline hover:no-underline focus:no-underline active:no-underline decoration-transparent relative inline-block transition-colors group-hover:text-[hsl(45_70%_60%)] after:block after:h-[2px] after:w-0 group-hover:after:w-full after:bg-transparent group-hover:after:bg-[hsl(45_70%_60%)] after:transition-all after:duration-300 after:mt-1">
                      {faq.question}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground bg-[#0C1119] border border-[#141B24] rounded-lg px-4 py-3 mt-2">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </div>
    </div>
  );
}