import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { DetectionBox, RecognitionResult } from '@/types/ai';
import { Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BadgePriceCanvas } from '@/components/ui/PriceCanvas';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/utils';
import type { ServerCurrency } from '@/types/api';

export interface SummaryItem extends RecognitionResult {
  unitPrice: number | null;
  totalPrice: number | null;
}

interface SummaryStageProps {
  imageFile: File;
  detections: DetectionBox[];
  results: SummaryItem[];
  onRemoveItem: (boxId: string) => void;
  onCopyAndFeedback: () => void;
  feedbackStatus: 'idle' | 'loading' | 'success' | 'error';
  feedbackError: string | null;
  currencies?: ServerCurrency[];
}

const RESIZE_CALC_DELAY = 50;
const TOOLTIP_DELAY = 300;

export function SummaryStage({
  imageFile,
  detections,
  results,
  onRemoveItem,
  onCopyAndFeedback,
  feedbackStatus,
  feedbackError,
  currencies,
}: SummaryStageProps) {
  const [imageData, setImageData] = useState<{ url: string; naturalWidth: number; naturalHeight: number } | null>(null);
  const [renderData, setRenderData] = useState<{ offsetLeft: number; offsetTop: number; renderWidth: number; renderHeight: number } | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listHeaderRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => setImageData({ url: objectUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  // Compute image render offset and size within the container (used for overlay positioning)
  useEffect(() => {
    const calculateOffset = () => {
      if (imageRef.current && containerRef.current && imageData) {
        const imageRect = imageRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        setRenderData({
          offsetLeft: imageRect.left - containerRect.left,
          offsetTop: imageRect.top - containerRect.top,
          renderWidth: imageRect.width,
          renderHeight: imageRect.height,
        });
      }
    };

    if (imageData) {
      const timer = setTimeout(calculateOffset, RESIZE_CALC_DELAY);
      window.addEventListener('resize', calculateOffset);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', calculateOffset);
      };
    }
  }, [imageData]);

  const grandTotal = useMemo(() => results.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0), [results]);

  const normalizedCurrencies = useMemo(
    () =>
      (currencies ?? [])
        .map((c) => ({
          name: c.name,
          symbol: c.symbol,
          threshold: typeof c.threshold === 'string' ? Number(c.threshold) : c.threshold,
        }))
        .filter((c) => Number.isFinite(c.threshold) && c.threshold > 0)
        .sort((a, b) => b.threshold - a.threshold),
    [currencies]
  );

  const renderFeedbackButtonContent = () => {
    switch (feedbackStatus) {
      case 'loading':
        return (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Wysyłanie...
          </>
        );
      case 'success':
        return (
          <>
            <Check className="h-4 w-4 mr-2" />
            Dziękujemy!
          </>
        );
      case 'error':
        return 'Spróbuj ponownie';
      default:
        return 'Kopiuj wyniki i pomóż ulepszyć AI';
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      {/* Left: image with detection overlays */}
      <div ref={containerRef} className="relative flex items-center justify-center bg-black/20 rounded-md overflow-hidden">
        {imageData && (
          <img
            ref={imageRef}
            src={imageData.url}
            alt="Podgląd ekwipunku"
            className="max-w-full max-h-full object-contain select-none"
          />
        )}
        {imageData && renderData && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: renderData.offsetLeft,
              top: renderData.offsetTop,
              width: renderData.renderWidth,
              height: renderData.renderHeight,
            }}
          >
            {detections.map((box, index) => {
              const left = (box.x / imageData.naturalWidth) * renderData.renderWidth;
              const top = (box.y / imageData.naturalHeight) * renderData.renderHeight;
              const width = (box.width / imageData.naturalWidth) * renderData.renderWidth;
              const height = (box.height / imageData.naturalHeight) * renderData.renderHeight;

              return (
                <div
                  key={box.id}
                  className="absolute border-2 border-emerald-500/80"
                  style={{ left, top, width, height }}
                >
                  <span
                    className="absolute top-0 left-0.5 bg-black/70 px-1 rounded-br-md text-white font-bold"
                    style={{ fontSize: '10px', lineHeight: '1' }}
                  >
                    {index + 1}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: summary list */}
      <div className="relative h-full min-h-[500px]">
        <div className="p-4 shrink-0" ref={listHeaderRef}>
          <h3 className="text-lg font-semibold text-slate-200">Podsumowanie wyceny</h3>
        </div>

        <div
          className="absolute left-0 right-0 overflow-y-auto custom-scrollbar pr-2 p-4 pt-0 space-y-2"
          style={{
            top: `${listHeaderRef.current?.offsetHeight ?? 0}px`,
            bottom: `${footerRef.current?.offsetHeight ?? 0}px`,
          }}
        >
          {results.map((item, index) => (
            <div key={item.boxId} className="grid grid-cols-[auto,1fr,auto,auto] items-center gap-4 p-3 rounded-md bg-black/20">
              <span className="font-bold text-slate-400 w-6 text-center">{index + 1}.</span>
              <div>
                <p className="font-medium text-slate-100">{item.itemName}</p>
                <BadgePriceCanvas
                  value={item.unitPrice}
                  formatValue={(price) =>
                    `${item.quantity} szt. × ${price != null ? formatCurrency(price, normalizedCurrencies) : 'Brak ceny'}`
                  }
                  style={{ color: '#94a3b8', fontSize: 12, padding: { x: 0, y: 2 } }}
                />
              </div>
              <Badge variant="secondary" className="justify-center border border-[#141B24] bg-[#0B1119]/50 px-2">
                {item.totalPrice != null ? (
                  <BadgePriceCanvas
                    value={item.totalPrice}
                    formatValue={(v) => formatCurrency(v, normalizedCurrencies)}
                    style={{ color: '#ffd166', fontSize: 14, padding: { x: 6, y: 4 } }}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">Brak danych</span>
                )}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemoveItem(item.boxId)}
                className="text-slate-400 hover:bg-red-900/50 hover:text-red-400 h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="absolute bottom-0 left-0 right-0 shrink-0 border-t border-[#141B24] bg-[#0B1119]/90 p-4" ref={footerRef}>
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold">Łączna wartość:</span>
            <Badge variant="secondary" className="text-lg px-4 py-2 bg-[#0B1119]/80 border border-[hsl(45_70%_60%)]">
              <BadgePriceCanvas
                value={grandTotal}
                formatValue={(v) => formatCurrency(v, normalizedCurrencies)}
                style={{ color: '#ffd166', fontSize: 16, padding: { x: 8, y: 4 } }}
              />
            </Badge>
          </div>

          <div className="mt-4 flex flex-col items-center justify-center">
            <TooltipProvider delayDuration={TOOLTIP_DELAY}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={onCopyAndFeedback}
                    disabled={feedbackStatus === 'loading' || feedbackStatus === 'success'}
                    className={`w-full max-w-xs ${
                      feedbackStatus === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' : ''
                    } ${feedbackStatus === 'error' ? 'bg-red-600 hover:bg-red-700' : ''}`}
                  >
                    {renderFeedbackButtonContent()}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center p-2" side="top">
                  <p>
                    Kliknięcie skopiuje wyniki i anonimowo prześle obraz oraz Twoje poprawki, aby pomóc nam w ulepszaniu AI. Dziękujemy za Twój wkład!
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {feedbackStatus === 'error' && (
              <p className="text-xs text-red-400 mt-2 text-center flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {feedbackError || 'Wystąpił błąd.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}