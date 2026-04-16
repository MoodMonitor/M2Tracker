const isRecorderEnabled = import.meta.env.DEV && import.meta.env.VITE_MSW_RECORD_FIXTURES === 'true';

const fixtureStore = new Map<string, unknown>();

function safeServerName(serverName: string): string {
  return (serverName || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fileNameFromUrl(rawUrl: string): string | null {
  const url = new URL(rawUrl, window.location.origin);
  const path = url.pathname;
  const server = safeServerName(url.searchParams.get('server_name') || 'ServerHard');
  const windowDay = Number(url.searchParams.get('window_day') || '14');

  if (path.endsWith('/api/v1/homepage/init')) return 'homepage_init.json';
  if (path.endsWith('/api/v1/homepage/vote-servers')) return 'homepage_vote_servers.json';
  if (path.endsWith('/api/v1/dashboard/init')) return `dashboard_init_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/stats/24h')) return `stats_24h_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/stats/shops/daily-window')) return `shops_${windowDay}d_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/stats/servers/daily-window')) return `servers_${windowDay}d_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/simple_items/suggest')) return `simple_suggest_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/bonus_items/suggest')) return `bonus_suggest_${server}.json`;
  if (path.endsWith('/api/v1/dashboard/bonus_items/bonus-types/suggest')) return `bonus_types_${server}.json`;

  return null;
}

function downloadJsonFile(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function recordFixture(rawUrl: string, payload: unknown): void {
  if (!isRecorderEnabled || !payload) return;
  const fileName = fileNameFromUrl(rawUrl);
  if (!fileName) return;
  fixtureStore.set(fileName, payload);
}

export function installFixtureRecorderBridge(): void {
  if (!isRecorderEnabled || typeof window === 'undefined') return;

  (window as any).__mswFixtureRecorder = {
    list: () => Array.from(fixtureStore.keys()).sort(),
    clear: () => fixtureStore.clear(),
    dump: () => Object.fromEntries(fixtureStore.entries()),
    downloadAll: () => {
      for (const [fileName, payload] of fixtureStore.entries()) {
        downloadJsonFile(fileName, payload);
      }
    },
    download: (fileName: string) => {
      const payload = fixtureStore.get(fileName);
      if (!payload) return false;
      downloadJsonFile(fileName, payload);
      return true;
    },
  };

  console.info('[fixture-recorder] Enabled. Use window.__mswFixtureRecorder.list() and downloadAll().');
}
