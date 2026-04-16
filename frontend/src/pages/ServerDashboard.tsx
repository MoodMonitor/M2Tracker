import { useParams } from 'react-router-dom';
import { useRef, useEffect, type FC, lazy, Suspense } from 'react';
import { Loader2, ShieldCheck, ShieldX, RefreshCw, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { DashboardNav } from '../components/dashboard/DashboardNav';
import { ServerInfoCard } from '../components/dashboard/ServerInfoCard';
import { QuickStats24h } from '../components/dashboard/QuickStats24h';
import { ShopCountChart } from '../components/dashboard/ShopCountChart';
import { TotalItemsChart } from '../components/dashboard/TotalItemsChart';
import SecureChart from '../components/dashboard/lineAndBarChart';
import { PriceCalculator } from '../components/dashboard/PriceCalculator';
import { ItemsTable } from '../components/dashboard/ItemsTable';
import SectionHeading from '../components/dashboard/SectionHeading';
import { useDashboardInfo } from '../hooks/useDashboardInfo';
import {DashboardInitState, useDashboardInit} from '../hooks/useDashboardInit';
import TurnstileWidget from '../components/TurnstileWidget';
import { pingDashboard } from '@/services/apiService';

const AIInventoryCalculator = lazy(() => import('@/components/dashboard/calculator_ai/AIInventoryCalculator').then(module => ({ default: module.AIInventoryCalculator })));


interface AuthOverlayProps extends DashboardInitState {
  retry: () => void;
  handleTurnstileVerify: (token: string) => void;
  handleTurnstileError: (errorCode: string) => void;
}

const AuthCard: FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, children, className = '' }) => (
  <div
    className={`flex w-full max-w-md flex-col items-center justify-center gap-4 rounded-xl border border-white/10 bg-black/25 p-8 text-center shadow-2xl backdrop-blur-lg ${className}`}
  >
    <div className="flex items-center gap-3">
      {icon}
      <h2 className="text-xl font-bold tracking-tight text-amber-300">{title}</h2>
    </div>
    {children}
  </div>
);

export default function ServerDashboard() {
  const { serverId } = useParams<{ serverId: string }>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const {
    isInitializing,
    isCheckingSession,
    canAccessDashboard,
    error: initError,
    retry,
    isTurnstileVerified,
    publicKey,
    showTurnstileTip,
    handleTurnstileVerify,
    handleTurnstileError
  } = useDashboardInit();

  const effectiveServerName = serverId ?? "";
  const { data: initData, loading: initLoading, error: infoError } = useDashboardInfo(
    // Only start fetching once the user has been granted access
    canAccessDashboard ? effectiveServerName : ''
  );

  // Ping the backend once dashboard data is loaded
  useEffect(() => {
    if (initData?.server?.name) {
      pingDashboard(initData.server.name);
    }
  }, [initData]);

  const renderAuthContent = () => {
    if (isInitializing || isCheckingSession) {
      return (
        <AuthCard title="Inicjalizacja sesji" icon={<Loader2 className="h-6 w-6 animate-spin text-amber-300" />}>
          <p className="text-sm text-slate-300">{isCheckingSession ? 'Sprawdzanie istniejącej sesji...' : 'Przygotowywanie bezpiecznego połączenia...'}</p>
        </AuthCard>
      );
    }

    if (!isTurnstileVerified) {
      return (
        <AuthCard title="Weryfikacja bezpieczeństwa" icon={<ShieldCheck className="h-6 w-6 text-amber-300" />}>
          <p className="text-sm text-slate-300">
            Aby uzyskać dostęp, prosimy o weryfikację, że nie jesteś robotem.
          </p>
          <div className="pt-4">
            {publicKey ? (
              <TurnstileWidget
                onVerify={handleTurnstileVerify}
                onError={handleTurnstileError}
                action="dashboard_access"
                cData={publicKey}
              />
            ) : (
              <div className="flex h-[65px] items-center justify-center text-sm text-muted-foreground">
                Oczekiwanie na klucz publiczny...
              </div>
            )}
             {showTurnstileTip && (
               <div className="mt-6 w-full flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-900/20 p-4 text-left">
                 <Info className="h-5 w-5 flex-shrink-0 text-blue-400" />
                 <div>
                   <h4 className="text-sm font-semibold text-blue-300">Wskazówka</h4>
                   <p className="mt-1 text-xs text-blue-300/80">
                     Aby uniknąć ponownej weryfikacji - nie odświeżaj strony.
                   </p>
                 </div>
               </div>
             )}
          </div>
          {initError && (
            <div className="mt-4 w-full rounded-md bg-red-500/10 p-3 text-left">
              <p className="text-xs text-red-400">Błąd: {initError}</p>
              <Button onClick={retry} variant="outline" size="sm" className="mt-2 w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Spróbuj ponownie
              </Button>
            </div>
          )}
        </AuthCard>
      );
    }

    if (!canAccessDashboard) {
      return (
        <AuthCard title="Brak dostępu" icon={<ShieldX className="h-6 w-6 text-red-400" />} className="border-red-500/50">
          <p className="text-sm text-slate-300">Nie udało się zweryfikować dostępu do dashboardu.</p>
          {initError && <p className="mt-2 text-xs text-red-400">Szczegóły: {initError}</p>}
          <Button onClick={retry} variant="outline" className="mt-4 w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            Spróbuj ponownie
          </Button>
        </AuthCard>
      );
    }

    return null;
  };

  return (
    <div
      ref={rootRef}
      className="min-h-screen relative"
      style={{
        backgroundImage: 'url(/img/page_background.png)',
        backgroundSize: '100% auto',
        backgroundPosition: 'top center',
        backgroundRepeat: 'repeat-y',
        backgroundAttachment: 'scroll'
      } as React.CSSProperties}
    >
      <div className="absolute inset-0 bg-black/60" />

      {(!canAccessDashboard || initLoading) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          {canAccessDashboard && initLoading ? (
            <AuthCard title="Ładowanie danych" icon={<Loader2 className="h-6 w-6 animate-spin text-amber-300" />}>
              <p className="text-sm text-slate-300">Pobieranie informacji o serwerze...</p>
            </AuthCard>
          ) : renderAuthContent()}
        </div>
      )}

      <div className={`container mx-auto px-4 py-16 space-y-12 relative z-10 transition-opacity duration-500 overflow-x-hidden ${!canAccessDashboard || initLoading ? 'opacity-0' : 'opacity-100'}`}>
        <DashboardNav
          currentServerName={initData?.server?.name ?? (serverId || undefined)}
          otherServers={initData?.other_servers}
          servers={initData?.other_servers?.map(name => ({
            id: name,
            name: name,
            activeShops: 0,
            lastUpdated: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            rating: { likes: 0, dislikes: 0 },
            difficulty: 'medium',
            status: 'active',
            links: {}
          })) || []}
        />

        {initData?.server && (
          <ServerInfoCard
            server={{
              id: serverId || initData.server.name,
              name: initData.server.name,
              activeShops: 0,
              lastUpdated: new Date().toISOString(),
              createdAt: new Date(initData.server.created_at).toISOString(),
              rating: { likes: 0, dislikes: 0 },
              difficulty: (initData.server.type?.toLowerCase?.() as any) || 'medium',
              status: initData.server.status ? 'active' : 'paused',
              links: {
                website: initData.server.website_url,
                forum: initData.server.forum_url,
                discord: initData.server.discord_url,
              },
            }}
            currency={initData.server.currency}
            info={initData.server}
          />
        )}

        <section id="quick-stats" className="animate-fade-in-up scroll-mt-24">
          <SectionHeading>Statystyki 24h</SectionHeading>
          <QuickStats24h
            key={effectiveServerName} 
            units={{ price: 'zł' }} 
            currencies={initData?.server?.currencies}
            serverName={initData?.server?.name ?? (serverId || '')} 
            enabled={canAccessDashboard} 
          />
        </section>

        <section id="market-activity" className="space-y-4 animate-fade-in scroll-mt-24">
          <SectionHeading>Aktywność rynkowa</SectionHeading>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ShopCountChart
              key={`${effectiveServerName}-shops`} 
              serverId={serverId!} 
              serverName={initData?.server?.name ?? (serverId || '')} 
              enabled={canAccessDashboard} 
            />
            <TotalItemsChart
              key={`${effectiveServerName}-items`} 
              serverId={serverId!} 
              serverName={initData?.server?.name ?? (serverId || '')} 
              enabled={canAccessDashboard} 
            />
          </div>
        </section>

        <section id="items-no-bonus" className="space-y-4 animate-fade-in-up min-h-0 scroll-mt-24">
          <SectionHeading>Przedmioty bez bonusów</SectionHeading>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 min-h-0 xl:h-[671px]">
            <div className="xl:col-span-3 min-h-0 h-full">
              <SecureChart
                key={effectiveServerName}
                chartId={`hist-${effectiveServerName}`}
                serverName={initData?.server?.name ?? (serverId || '')}
                currencies={initData?.server?.currencies}
                useMock={false}
              />
            </div>
            <div className="xl:col-span-2 min-h-0 flex items-stretch overflow-hidden h-full">
              <PriceCalculator key={effectiveServerName} serverId={serverId!} serverName={initData?.server?.name ?? (serverId || '')} currencies={initData?.server?.currencies} />
            </div>
          </div>
           <div className="pt-8">
             <Suspense fallback={
               <Card className="w-full bg-[#0B1119]/60 border border-[#141B24] min-h-[600px] flex items-center justify-center">
                 <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
               </Card>
             }>
               <AIInventoryCalculator currencies={initData?.server?.currencies} />
             </Suspense>
           </div>
        </section>

        <section id="items-with-bonus" className="space-y-4 animate-fade-in scroll-mt-24">
          <SectionHeading>Przedmioty z bonusami</SectionHeading>
          <ItemsTable key={effectiveServerName} serverId={serverId!} serverName={initData?.server?.name ?? (serverId || '')} currencies={initData?.server?.currencies} />
        </section>
        
      </div>
    </div>
  );
}
