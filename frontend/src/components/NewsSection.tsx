import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NewsItem } from "@/types/content";
import { Calendar, Plus, Server, Wrench } from "lucide-react";

interface NewsSectionProps {
  news: NewsItem[];
}

const newsIcons = {
  feature: Plus,
  server: Server,
  update: Wrench,
  news: Calendar,
  changelog: Wrench,
} as const;

const newsVariants = {
  feature: "success",
  server: "default", 
  update: "secondary",
  news: "default",
  changelog: "secondary",
} as const;

export function NewsSection({ news }: NewsSectionProps) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="mb-6 text-center flex-shrink-0">
        <h2 className="fantasy-heading fantasy-heading-medium text-[hsl(45_70%_60%)] mb-2 hover:text-[hsl(45_70%_70%)] transition-all duration-300 cursor-default hover:scale-105">Aktualności i Changelog</h2>
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
        <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar">
          {news.map((item) => {
            const Icon = newsIcons[item.type];
            return (
              <div
                key={item.id}
                className="flex items-start gap-3 p-4 rounded-lg bg-[#090D15] border border-[#141B24] hover:bg-[#0D141F] hover:border-[#1a2330] transition-all duration-300 hover:shadow-md"
              >
                <div className="flex-shrink-0 mt-1">
                  <Icon className="h-4 w-4 text-[hsl(45_70%_60%)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-sm text-white">{item.title}</h4>
                    <Badge variant={newsVariants[item.type]} className="text-xs">
                      {item.type === 'feature' && 'Funkcja'}
                      {item.type === 'server' && 'Serwer'}
                      {item.type === 'update' && 'Aktualizacja'}
                      {item.type === 'news' && 'Informacja'}
                      {item.type === 'changelog' && 'Changelog'}
                    </Badge>
                  </div>
                  {item.description && (
                    <p className="text-sm text-gray-300 mb-2 leading-relaxed whitespace-pre-line break-words">
                      {item.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    {new Date(item.date).toLocaleDateString('pl-PL')}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}