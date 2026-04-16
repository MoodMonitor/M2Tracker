import { HttpError } from '@/services/httpError';
/*
  Global Error Reporter
  - Captures JS runtime errors (window.onerror)
  - Captures unhandled promise rejections
  - Intercepts fetch() to capture network errors and non-OK responses
  - Intercepts console.* to collect recent log lines
  - Collects lightweight user activity breadcrumbs (clicks, navigation)
  - Provides a manual report API with metadata
  - Debounces submissions to avoid flooding
*/

export type ErrorKind = 'js' | 'promise' | 'fetch' | 'manual'

export interface ErrorMetadata {
  timestamp: string
  url: string
  userAgent: string
  language?: string
  platform?: string
  referrer?: string
  screen?: { width: number; height: number; pixelRatio?: number }
  online?: boolean
  timezoneOffset?: number
  deviceMemory?: number
  network?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'
export interface ConsoleEntry {
  level: ConsoleLevel
  message: string
  args?: string
  timestamp: string
}

export type BreadcrumbType = 'click' | 'navigation' | 'custom'
export interface BreadcrumbEntry {
  type: BreadcrumbType
  data: Record<string, any>
  timestamp: string
}

export interface ErrorPayload {
  kind: ErrorKind
  message: string
  stack?: string
  component?: string
  // Fetch-specific
  fetch?: {
    url: string
    method?: string
    status?: number
    statusText?: string
    requestBodyPreview?: any
    responseTextPreview?: string
  }
  // Optional user comment
  comment?: string
  // Extra context provided by caller
  context?: Record<string, any>
  // Extra captured context
  consoleLogs?: ConsoleEntry[]
  breadcrumbs?: BreadcrumbEntry[]
  metadata: ErrorMetadata
}

// Small ring buffers
const MAX_ERROR_BUFFER = 20
const MAX_CONSOLE_BUFFER = 100
const MAX_BREADCRUMB_BUFFER = 100

// Store pending setTimeout IDs to allow cancellation
const pendingReportTimers = new Set<NodeJS.Timeout>();

const recentErrors: ErrorPayload[] = []
const consoleBuffer: ConsoleEntry[] = []
const breadcrumbBuffer: BreadcrumbEntry[] = []

// Debounce window to avoid flooding
const DEBOUNCE_MS = 2000
let lastSentAt = 0
let autoReportingEnabled = true

function safeStringify(value: any, fallback = ''): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack }
      }
      if (typeof v === 'bigint') return v.toString()
      return v
    })
  } catch {
    try { return String(value) } catch { return fallback }
  }
}

function safeGetMetadata(): ErrorMetadata {
  try {
    const nav = navigator as any
    const connection = nav?.connection || nav?.mozConnection || nav?.webkitConnection
    return {
      timestamp: new Date().toISOString(),
      url: window.location?.href ?? 'unknown',
      userAgent: navigator?.userAgent ?? 'unknown',
      language: navigator?.language,
      platform: navigator?.platform,
      referrer: document?.referrer,
      screen: {
        width: window.screen?.width ?? 0,
        height: window.screen?.height ?? 0,
        pixelRatio: (window.devicePixelRatio as number) || 1,
      },
      online: navigator?.onLine,
      timezoneOffset: new Date().getTimezoneOffset(),
      deviceMemory: (nav?.deviceMemory as number) || undefined,
      network: connection ? {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData,
      } : undefined,
    }
  } catch {
    return {
      timestamp: new Date().toISOString(),
      url: 'unknown',
      userAgent: 'unknown',
    }
  }
}

function pushRecent(payload: ErrorPayload) {
  try {
    recentErrors.unshift(payload)
    if (recentErrors.length > MAX_ERROR_BUFFER) recentErrors.pop()
  } catch {
    // ignore
  }
}

function pushConsole(entry: ConsoleEntry) {
  try {
    consoleBuffer.unshift(entry)
    if (consoleBuffer.length > MAX_CONSOLE_BUFFER) consoleBuffer.pop()
  } catch { /* ignore */ }
}

function pushBreadcrumb(entry: BreadcrumbEntry) {
  try {
    breadcrumbBuffer.unshift(entry)
    if (breadcrumbBuffer.length > MAX_BREADCRUMB_BUFFER) breadcrumbBuffer.pop()
  } catch { /* ignore */ }
}

function getConsoleLogs(limit = 50): ConsoleEntry[] {
  return consoleBuffer.slice(0, limit)
}

function getBreadcrumbs(limit = 50): BreadcrumbEntry[] {
  return breadcrumbBuffer.slice(0, limit)
}

function shouldDebounce(): boolean {
  const now = Date.now()
  if (now - lastSentAt < DEBOUNCE_MS) return true
  lastSentAt = now
  return false
}

async function submitReport(payload: ErrorPayload) {
  if (!autoReportingEnabled && payload.kind !== 'manual') return;
  try {
    if (import.meta.env.DEV) {
      console.groupCollapsed('[ErrorReporter] Report payload (DEV)')
      console.log(payload)
      console.groupEnd()
    }

    // Standard fetch is fine here — this endpoint is public and does not need signing
    const { endpoints } = await import('@/config/api');
    await fetch(endpoints.submitBugReport(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true, // allows the request to complete even if the page is unloading
    });
  } catch {
    // Submission errors are intentionally swallowed to avoid error loops
  }
}

function normalizeErrorMessage(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try {
    return { message: JSON.stringify(err) }
  } catch {
    return { message: String(err) }
  }
}

function installConsoleCapture() {
  try {
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    }
    // In production, only capture warn/error to reduce the risk of inadvertently
    // collecting sensitive data (tokens, API payloads) that developers may log
    // at lower levels during testing.
    const capturedLevels: ConsoleLevel[] = import.meta.env.PROD
      ? ['warn', 'error']
      : ['log', 'info', 'warn', 'error', 'debug'];
    ;(['log','info','warn','error','debug'] as ConsoleLevel[]).forEach((level) => {
      // @ts-ignore
      console[level] = (...args: any[]) => {
        try {
          if (capturedLevels.includes(level)) {
            const entry: ConsoleEntry = {
              level,
              message: args.map(a => typeof a === 'string' ? a : safeStringify(a)).join(' '),
              args: args.length > 1 ? safeStringify(args) : undefined,
              timestamp: new Date().toISOString(),
            }
            pushConsole(entry)
          }
        } catch { /* ignore */ }
        // call original
        try {
          // @ts-ignore
          original[level].apply(console, args)
        } catch { /* ignore */ }
      }
    })
  } catch { /* ignore */ }
}

function summarizeElement(el: Element | null | undefined): Record<string, any> {
  try {
    if (!el) return {}
    const attrs: Record<string, any> = {
      tag: el.tagName,
      id: (el as HTMLElement).id || undefined,
      class: (el as HTMLElement).className || undefined,
    }
    const text = (el as HTMLElement).innerText || (el as HTMLElement).textContent || ''
    // Capture data-* attributes which often hold useful context
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        attrs[attr.name] = attr.value;
      }
    }
    if (text) attrs.text = text.trim().slice(0, 80)
    return attrs
  } catch {
    return {}
  }
}

function installClickCapture() {
  try {
    let lastTs = 0
    document.addEventListener('click', (ev) => {
      try {
        const now = Date.now()
        if (now - lastTs < 300) return // throttle noisy clicks
        lastTs = now
        const target = ev.target as Element | null
        pushBreadcrumb({
          type: 'click',
          data: { target: summarizeElement(target) },
          timestamp: new Date().toISOString(),
        })
      } catch { /* ignore */ }
    }, true)
  } catch { /* ignore */ }
}

function installNavigationCapture() {
  try {
    const push = history.pushState
    const replace = history.replaceState
    const record = (from: string, to: string, method: 'pushState' | 'replaceState' | 'popstate') => {
      pushBreadcrumb({
        type: 'navigation',
        data: { from, to, method },
        timestamp: new Date().toISOString(),
      })
    }
    history.pushState = function (...args: any[]) {
      try { record(location.href, String(args[2] ?? location.href), 'pushState') } catch { /* ignore */ }
      // @ts-ignore
      return push.apply(this, args)
    }
    history.replaceState = function (...args: any[]) {
      try { record(location.href, String(args[2] ?? location.href), 'replaceState') } catch { /* ignore */ }
      // @ts-ignore
      return replace.apply(this, args)
    }
    window.addEventListener('popstate', () => {
      try { record('unknown', location.href, 'popstate') } catch { /* ignore */ }
    })
  } catch { /* ignore */ }
}

function attachCommonContext(payload: ErrorPayload): ErrorPayload {
  try {
    // Limit as per UI requirement: last 25 console logs and last 19 activities
    payload.consoleLogs = getConsoleLogs(25)
    payload.breadcrumbs = getBreadcrumbs(19)
  } catch { /* ignore */ }
  return payload
}

export const errorReporter = {
  initialized: false,
  initGlobalErrorCapture() {
    if (this.initialized) return
    this.initialized = true

    installConsoleCapture()
    installClickCapture()
    installNavigationCapture()

    // window.onerror for synchronous JS errors
    try {
      const prev = window.onerror
      window.onerror = (message: any, source?: string, lineno?: number, colno?: number, error?: any) => {
        try {
          const meta = safeGetMetadata()
          const { message: msg, stack } = normalizeErrorMessage(error ?? message)
          const payload: ErrorPayload = attachCommonContext({
            kind: 'js',
            message: msg || String(message),
            stack: stack,
            context: { source, lineno, colno },
            metadata: meta,
          })
          pushRecent(payload)
          // Give ErrorBoundary a moment to intercept and disable auto-reporting
          const timerId = setTimeout(() => {
            pendingReportTimers.delete(timerId);
            if (!shouldDebounce()) submitReport(payload) // This will be controlled by autoReportingEnabled
          }, 50);
          pendingReportTimers.add(timerId);
        } catch { /* ignore */ }
        return prev ? prev(message, source as any, lineno as any, colno as any, error) : false
      }
    } catch { /* ignore */ }

    // unhandledrejection for async promise errors
    try {
      window.addEventListener('unhandledrejection', (event) => {
        // Skip HttpErrors — they are handled via eventBus and are not critical app errors
        if ((event as PromiseRejectionEvent).reason instanceof HttpError) {
          return;
        }

        try {
          const meta = safeGetMetadata()
          const { message, stack } = normalizeErrorMessage((event as PromiseRejectionEvent).reason)
          const payload: ErrorPayload = attachCommonContext({
            kind: 'promise',
            message,
            stack,
            metadata: meta,
          })
          pushRecent(payload)
          // Give ErrorBoundary a moment to intercept and disable auto-reporting
          const timerId = setTimeout(() => {
            pendingReportTimers.delete(timerId);
            if (!shouldDebounce()) submitReport(payload) // This will be controlled by autoReportingEnabled
          }, 50);
          pendingReportTimers.add(timerId);
        } catch { /* ignore */ }
      })
    } catch { /* ignore */ }

    // fetch interception
    try {
      const nativeFetch = window.fetch
      const patchedFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const start = Date.now()
        try {
          const res = await nativeFetch(input as any, init)
          if (!res.ok) {
            // Skip 401/429 — handled globally via toast/session logic
            if (res.status === 401 || res.status === 429) {
              return res;
            }

            // Do NOT read the response body — it may contain session data or PII.
            // Status code and statusText are sufficient for diagnosis.
            const meta = safeGetMetadata()
            const payload: ErrorPayload = attachCommonContext({
              kind: 'fetch',
              message: `Fetch failed with status ${res.status}: ${res.statusText}`,
              metadata: meta,
              fetch: {
                url: typeof input === 'string' ? input : (input as URL).toString(),
                method: init?.method,
                status: res.status,
                statusText: res.statusText,
                // responseTextPreview intentionally omitted — response body may contain PII
              },
              context: {
                durationMs: Date.now() - start,
              },
            })
            pushRecent(payload)
            if (!shouldDebounce()) submitReport(payload) // This will be controlled by autoReportingEnabled
          }
          return res
        } catch (err) {
          const meta = safeGetMetadata()
          const { message, stack } = normalizeErrorMessage(err)
          // Send only the JSON key names, never the values — values may contain PII or tokens.
          let bodyPreview: any
          try {
            if (init && init.body && typeof init.body === 'string') {
              const parsed = JSON.parse(init.body as string)
              bodyPreview = typeof parsed === 'object' && parsed !== null
                ? Object.keys(parsed)
                : '[non-object body]'
            }
          } catch { /* ignore */ }
          const payload: ErrorPayload = attachCommonContext({
            kind: 'fetch',
            message,
            stack,
            metadata: meta,
            fetch: {
              url: typeof input === 'string' ? input : (input as URL).toString(),
              method: init?.method,
              requestBodyPreview: bodyPreview,
            },
            context: {
              durationMs: Date.now() - start,
            },
          })
          pushRecent(payload)
          if (!shouldDebounce()) submitReport(payload) // This will be controlled by autoReportingEnabled
          throw err
        }
      }
      // @ts-ignore
      window.fetch = patchedFetch
    } catch { /* ignore */ }
  },

  reportManual(comment?: string, extraContext?: Record<string, any>) {
    try {
      const meta = safeGetMetadata()
      const last = recentErrors[0]
      const payload: ErrorPayload = attachCommonContext({
        kind: 'manual',
        message: last?.message || 'Manual report (no captured error in buffer)',
        stack: last?.stack,
        fetch: last?.fetch,
        comment,
        context: { ...last?.context, ...extraContext },
        metadata: meta,
      })
      // Debounce here too — guards against a race with auto-handlers firing on the same error
      if (shouldDebounce()) return { success: true, debounced: true };
      pushRecent(payload)
      submitReport(payload)
      return { success: true }
    } catch (e) {
      try { console.warn('[ErrorReporter] Failed to submit manual report', e) } catch { /* ignore */ }
      return { success: false, error: (e as any)?.message }
    }
  },

  getRecent(limit = 10): ErrorPayload[] {
    return recentErrors.slice(0, limit)
  },

  getConsoleLogs(limit = 50): ConsoleEntry[] {
    return getConsoleLogs(limit)
  },

  getBreadcrumbs(limit = 50): BreadcrumbEntry[] {
    return getBreadcrumbs(limit)
  },

  setAutoReporting(enabled: boolean) {
    autoReportingEnabled = enabled;
  },

  isAutoReportingEnabled(): boolean {
    return autoReportingEnabled;
  },

  clearPendingTimers() {
    pendingReportTimers.forEach(timerId => {
      clearTimeout(timerId);
    });
    pendingReportTimers.clear();
  }
}

export type { ErrorPayload as ReportPayload, ConsoleEntry, BreadcrumbEntry }
