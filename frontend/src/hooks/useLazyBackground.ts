import { useCallback } from "react";

// Lazily applies background image from data-bg when the element enters the viewport.
export function useLazyBackground() {
  const observe = useCallback((el: HTMLElement) => {
    const tryApply = (target: HTMLElement) => {
      const dataBg = target.getAttribute('data-bg');
      if (!dataBg) return false;
      target.style.backgroundImage = dataBg;
      target.removeAttribute('data-bg');
      return true;
    };

    // Apply immediately if already in viewport
    try {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const intersects = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
      if (intersects && tryApply(el)) return;
    } catch {}

    if (!('IntersectionObserver' in window)) {
      const dataBg = el.getAttribute('data-bg');
      if (dataBg) el.style.backgroundImage = dataBg;
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const target = entry.target as HTMLElement;
          tryApply(target);
          obs.unobserve(target);
        }
      }
    }, { rootMargin: '200px' });

    io.observe(el);

    // Fallback in case IntersectionObserver fires late
    const timer = window.setTimeout(() => tryApply(el), 750);
    return () => {
      try { window.clearTimeout(timer); } catch {}
    };
  }, []);

  return observe;
}
