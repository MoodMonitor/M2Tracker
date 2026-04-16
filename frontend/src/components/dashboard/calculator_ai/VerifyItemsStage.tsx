import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { DetectionBox, RecognitionResult } from '@/types/ai';
import type { ItemOption } from '@/types/api';
import { ItemCombobox } from './ItemCombobox';

interface VerifyItemsStageProps {
  imageFile: File;
  serverName: string;
  detections: DetectionBox[];
  results: RecognitionResult[];
  onRemoveResult: (boxId: string) => void;
  onUpdateResult: (boxId: string, newValue: ItemOption | string, newQuantity: number) => void;
}

const RESIZE_CALC_DELAY = 50;
const HOVER_SCROLL_DELAY = 300;
const MIN_ITEM_QUANTITY = 1;
const MAX_ITEM_QUANTITY = 999;

const sanitizeQuantity = (quantity: number): number => {
  if (!Number.isFinite(quantity)) return MIN_ITEM_QUANTITY;
  const normalized = Math.trunc(quantity);
  return Math.min(MAX_ITEM_QUANTITY, Math.max(MIN_ITEM_QUANTITY, normalized));
};

export function VerifyItemsStage({
  imageFile,
  serverName,
  detections,
  results,
  onRemoveResult,
  onUpdateResult,
}: VerifyItemsStageProps) {
  const [imageData, setImageData] = useState<{ url: string; naturalWidth: number; naturalHeight: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [renderData, setRenderData] = useState<{
    offsetLeft: number;
    offsetTop: number;
    renderWidth: number;
    renderHeight: number;
  } | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      setImageData({ url: objectUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    };
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  useEffect(() => {
    itemRefs.current.clear();
    results.forEach((result) => itemRefs.current.set(result.boxId, null));
  }, [results]);

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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      {/* Left: image with numbered detections */}
      <div ref={containerRef} className="relative flex items-center justify-center bg-black/20 rounded-md overflow-hidden">
        {imageData && (
          <img ref={imageRef} src={imageData.url} alt="Podgląd ekwipunku" className="max-w-full max-h-full object-contain select-none" />
        )}

        {renderData && imageData && (
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
              const result = results.find((r) => r.boxId === box.id);
              const needsAttention = result && (result.suggestions?.length ?? 0) > 1;

              const left = (box.x / imageData.naturalWidth) * renderData.renderWidth;
              const top = (box.y / imageData.naturalHeight) * renderData.renderHeight;
              const width = (box.width / imageData.naturalWidth) * renderData.renderWidth;
              const height = (box.height / imageData.naturalHeight) * renderData.renderHeight;

              return (
                <div
                  key={box.id}
                  onMouseEnter={() => {
                    setHoveredId(box.id);
                    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                    scrollTimeoutRef.current = window.setTimeout(() => {
                      const element = itemRefs.current.get(box.id);
                      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }, HOVER_SCROLL_DELAY);
                  }}
                  onMouseLeave={() => {
                    setHoveredId(null);
                    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                  }}
                  className={`absolute border-2 flex items-center justify-center transition-all pointer-events-auto ${
                    hoveredId === box.id
                      ? 'border-orange-400 bg-orange-400/20'
                      : needsAttention
                      ? 'border-amber-400/60'
                      : 'border-emerald-500/80'
                  }`}
                  style={{ left, top, width, height }}
                >
                  <span
                    className={`absolute top-0 left-0.5 bg-black/70 px-1 rounded-br-md font-bold ${
                      needsAttention ? 'text-amber-400' : 'text-white'
                    }`}
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

      {/* Right: results list */}
      <div className="relative h-full min-h-[500px]">
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar pr-2 p-4 space-y-3">
          <div className="space-y-3 pb-4">
            <h3 className="text-lg font-semibold text-slate-200">Krok 2: Weryfikacja rozpoznanych przedmiotów</h3>
            <div className="text-sm text-slate-400 leading-relaxed space-y-3">
              <p>
                Każdy wykryty slot na obrazie jest ponumerowany. Numery te odpowiadają pozycjom na liście rozpoznanych przedmiotów poniżej.
              </p>
              <ul className="list-disc list-inside space-y-2 pl-2">
                <li>
                  Sloty <b className="text-amber-400">oznaczone na żółto</b> wymagają Twojej uwagi - oznacza to, że model nie jest pewien rozpoznania (np. z powodu podobieństwa ikon), wybierz właściwy przedmiot z listy.
                </li>
                <li>
                  Możesz najechać kursorem na wybrany box na screenshocie - lista automatycznie przewinie się do odpowiadającego mu rozpoznania.
                </li>
                <li>
                  Jeśli nazwa przedmiotu jest błędna, kliknij na nią i znajdź poprawną używając wyszukiwarki.
                </li>
                <li>Popraw ilość, jeśli została odczytana nieprawidłowo.</li>
              </ul>
            </div>
          </div>

          {results.map((result, index) => (
            <div
              ref={(el) => itemRefs.current.set(result.boxId, el)}
              key={result.boxId}
              onMouseEnter={() => setHoveredId(result.boxId)}
              onMouseLeave={() => setHoveredId(null)}
              className={`grid grid-cols-[auto,1fr,auto,auto] items-center gap-4 p-3 rounded-md transition-all ${
                hoveredId === result.boxId ? 'bg-orange-400/10' : 'bg-black/20'
              }`}
            >
              <span className="font-bold text-slate-400 w-6 text-center">{index + 1}.</span>

              <ItemCombobox
                value={result.itemName}
                onChange={(newValue) => onUpdateResult(result.boxId, newValue, result.quantity)}
                initialSuggestions={result.suggestions.map((s) => s.name)}
                serverName={serverName}
              />

              <Input
                type="number"
                value={result.quantity}
                min={MIN_ITEM_QUANTITY}
                max={MAX_ITEM_QUANTITY}
                step={1}
                onChange={(e) => {
                  const parsedQty = Number.parseInt(e.target.value, 10);
                  const newQty = sanitizeQuantity(parsedQty);
                  onUpdateResult(
                    result.boxId,
                    { value: result.itemName, label: result.itemName, vid: result.itemVid ?? 0 },
                    newQty
                  );
                }}
                className="h-9 w-20 text-center bg-[#0B1119]/85 border-[#141B24]"
              />

              <Button
                variant="ghost"
                size="icon"
                className="text-red-500 hover:text-red-400 hover:bg-red-500/10 h-9 w-9"
                onClick={() => onRemoveResult(result.boxId)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}