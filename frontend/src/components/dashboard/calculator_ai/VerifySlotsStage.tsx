import React, { useEffect, useState, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import type { DetectionBox } from '@/types/ai';

interface VerifySlotsStageProps {
  imageFile: File;
  detections: DetectionBox[];
  onRemoveDetection: (id: string) => void;
}

const RESIZE_CALC_DELAY = 50;

export function VerifySlotsStage({ imageFile, detections, onRemoveDetection }: VerifySlotsStageProps) {
  const [imageData, setImageData] = useState<{
    url: string;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);

  const [renderData, setRenderData] = useState<{
    offsetLeft: number;
    offsetTop: number;
    renderWidth: number;
    renderHeight: number;
  } | null>(null);

  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const calculateOffset = () => {
      if (imageRef.current && containerRef.current) {
        const { offsetLeft, offsetTop, clientWidth, clientHeight } = imageRef.current;
        setRenderData({ offsetLeft, offsetTop, renderWidth: clientWidth, renderHeight: clientHeight });
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

  if (!imageData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Ładowanie obrazu...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      {/* Left: image with detection boxes */}
      <div ref={containerRef} className="relative flex items-center justify-center bg-black/20 rounded-md overflow-hidden">
        <img
          ref={imageRef}
          src={imageData.url}
          alt="Podgląd ekwipunku"
          className="max-w-full max-h-full object-contain select-none"
        />

        {renderData && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: renderData.offsetLeft,
              top: renderData.offsetTop,
              width: renderData.renderWidth,
              height: renderData.renderHeight,
            }}
          >
            {detections.map((box) => (
              <button
                key={box.id}
                onClick={() => onRemoveDetection(box.id)}
                title="Usuń detekcję"
                className="absolute group border-2 border-red-500 hover:bg-red-500/30 transition-colors flex items-center justify-center pointer-events-auto"
                style={{
                  left: `${(box.x / imageData.naturalWidth) * renderData.renderWidth}px`,
                  top: `${(box.y / imageData.naturalHeight) * renderData.renderHeight}px`,
                  width: `${(box.width / imageData.naturalWidth) * renderData.renderWidth}px`,
                  height: `${(box.height / imageData.naturalHeight) * renderData.renderHeight}px`,
                }}
              >
                <X className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: step description */}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-slate-200 mb-3">Krok 1: Weryfikacja wykrytych slotów</h3>
        <div className="text-sm text-slate-400 leading-relaxed space-y-3">
          <p>
            Na podstawie przesłanego screenshota model AI (YOLO) zaznaczył wszystkie potencjalne sloty z przedmiotami - zostały one oznaczone czerwonymi ramkami (boxami).
          </p>
          <p>
            Sprawdź, czy detekcja przebiegła poprawnie. Jeśli któryś box został zaznaczony błędnie (np. objął fragment interfejsu), możesz go usunąć, klikając na jego środek.
          </p>
          <p className="font-medium text-slate-300 pt-2">
            ➡️ Tylko zaznaczone boxy zostaną przesłane do dalszego rozpoznawania, dlatego ważne jest, aby skorygować ewentualne błędy przed przejściem dalej.
          </p>
        </div>
      </div>
    </div>
  );
}