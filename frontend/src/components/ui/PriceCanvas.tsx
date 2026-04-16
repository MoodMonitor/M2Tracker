import { useEffect, useRef } from "react";
import { cn, formatCurrency } from "@/lib/utils";

export interface PriceCanvasProps {
  value: number;
  className?: string;
  /**
   * Display mode:
   * - 'responsive': full width, fixed height (36px) — for table cells
   * - 'auto': sized to content with padding — for badges/labels
   */
  mode?: 'responsive' | 'auto';
  /** Custom formatter. Defaults to gold k/kk/kkk formatting. */
  formatValue?: (value: number) => string;
  style?: {
    fontSize?: number;
    fontWeight?: string | number;
    color?: string;
    padding?: { x: number; y: number };
  };
}

/**
 * Canvas-based price renderer — prevents text copying / DOM inspection.
 * Supports responsive (table cell) and auto-sized (badge) modes.
 */
export function PriceCanvas({
  value,
  className,
  mode = 'responsive',
  formatValue = (v) => formatCurrency(v, []),
  style = {}
}: PriceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const text = formatValue(value);

    const fontSize = style.fontSize ?? 14;
    const fontWeight = style.fontWeight ?? 600;
    const color = style.color ?? 'hsl(45, 70%, 60%)';
    const fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    const font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    if (mode === 'responsive') {
      const cssHeight = 36;
      canvas.style.width = '100%';
      canvas.style.height = `${cssHeight}px`;

      const width = Math.max(40, Math.floor(canvas.clientWidth));
      const height = cssHeight;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, width, height);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, Math.floor(width / 2), Math.floor(height / 2));

    } else {
      // Auto mode: measure text first, then size the canvas to fit
      ctx.font = font;
      const metrics = ctx.measureText(text);

      const paddingX = style.padding?.x ?? 12;
      const paddingY = style.padding?.y ?? 8;
      const cssWidth = Math.ceil(metrics.width) + paddingX;
      const cssHeight = fontSize + paddingY;

      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, paddingX / 2, cssHeight / 2);
    }
  };

  useEffect(() => {
    const raf = requestAnimationFrame(drawCanvas);
    return () => cancelAnimationFrame(raf);
  }, [value, mode, formatValue, style]);

  useEffect(() => {
    if (mode !== 'responsive') return;
    const handleResize = () => drawCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "select-none pointer-events-none",
        mode === 'responsive' ? "block w-full" : "inline-block",
        className
      )}
      aria-hidden="true"
    />
  );
}

/** Convenience wrapper for table cells (responsive mode). */
export function TablePriceCanvas({
  value,
  className,
  formatValue,
  style,
}: {
  value: number;
  className?: string;
  formatValue?: PriceCanvasProps['formatValue'];
  style?: PriceCanvasProps['style'];
}) {
  return (
    <PriceCanvas
      value={value}
      mode="responsive"
      className={className}
      formatValue={formatValue}
      style={style}
    />
  );
}

/** Convenience wrapper for badges/labels (auto mode). */
export function BadgePriceCanvas({
  value,
  className,
  style,
  formatValue,
}: {
  value: number;
  className?: string;
  style?: PriceCanvasProps['style'];
  formatValue?: PriceCanvasProps['formatValue'];
}) {
  return (
    <PriceCanvas
      value={value}
      mode="auto"
      className={className}
      style={style}
      formatValue={formatValue}
    />
  );
}
