import { ServerCard } from "@/components/ServerCard";
import { NewsSection } from "@/components/NewsSection";
import { VotingSection } from "@/components/VotingSection";
import { FAQSection } from "@/components/FAQSection";
import { Navigation } from "@/components/Navigation";
import { useFaqs } from "@/hooks/useFaqs";
import { useNavigate } from "react-router-dom";
import { useLazyBackground } from "@/hooks/useLazyBackground";
import { useRef, useEffect, useState } from "react";
import { getHomepageInit, getVoteServers } from "@/services/apiService";
import type { Server as ContentServer, NewsItem, ServerCandidate } from "@/types/content";

const Index = () => {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const heroTextureRef = useRef<HTMLDivElement | null>(null);
  const heroDragonRef = useRef<HTMLDivElement | null>(null);
  const { data: faqs } = useFaqs();

  // Homepage init state
  const [servers, setServers] = useState<ContentServer[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [candidates, setCandidates] = useState<ServerCandidate[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);

  // Lazy load large background images when visible
  const observeBg = useLazyBackground();
  useEffect(() => {
    if (rootRef.current) observeBg(rootRef.current);
    if (heroTextureRef.current) observeBg(heroTextureRef.current);
    if (heroDragonRef.current) observeBg(heroDragonRef.current);
  }, [observeBg]);

  // Fetch homepage init data
  useEffect(() => {
    let isMounted = true;

    const fetchInitData = async () => {
      try {
        const data = await getHomepageInit();
        if (!isMounted) return;

        setServers(data.servers.map((s) => ({
          id: s.name,
          name: s.name,
          activeShops: 0,
          lastUpdated: new Date().toISOString(),
          lastUpdatedHuman: s.last_data_update_human || undefined,
          createdAt: new Date(s.created_at).toISOString(),
          rating: { likes: 0, dislikes: 0 },
          difficulty: (s.type?.toLowerCase?.() as ContentServer['difficulty']) || 'medium',
          status: s.status ? 'active' : 'paused',
          links: {},
        })));

        const mappedNews = data.updates.map((u) => ({
          id: String((u as any)?.id),
          title: (u as any)?.title,
          date: (u as any)?.created_at,
          type: (u as any)?.type,
          description: (u as any)?.content ?? (u as any)?.description ?? undefined,
        }));
        setNews(mappedNews);

      } catch (e: any) {
        if (isMounted) setHomeError(e?.message ?? 'Błąd pobierania danych strony głównej');
      }
    };

    const fetchVoteData = async () => {
      try {
        const voteData = await getVoteServers();
        if (!isMounted) return;
        setCandidates(voteData.map((v) => ({
          id: v.name,
          name: v.name,
          votes: v.total_votes,
          requestedBy: 'społeczność',
        })));
      } catch (e: any) {
        console.warn('Failed to fetch voting candidates:', e);
      }
    };

    const fetchAllData = async () => {
      setLoadingHome(true);
      await Promise.all([fetchInitData(), fetchVoteData()]);
      if (isMounted) {
        setHomeError(null);
        setLoadingHome(false);
      }
    };

    fetchAllData();

    return () => { isMounted = false; };
  }, []);

  return (
    <div
      ref={rootRef}
      className="min-h-screen relative animate-fade-in"
      data-bg="url(/img/page_background.png)"
      style={{
        backgroundSize: '100% auto',
        backgroundPosition: 'top center',
        backgroundRepeat: 'repeat-y',
        backgroundAttachment: 'scroll'
      } as React.CSSProperties}
    >
      <div className="absolute inset-0 bg-black/40 pointer-events-none"></div>
      
      <div className="flex justify-center">
        <div
          className="relative w-full max-w-[1400px]"
          style={{ height: 600 }}
        >
          <Navigation variant="overlay" />

          <div
            ref={heroTextureRef}
            className="absolute inset-0 bg-center bg-cover animate-fade-in"
            data-bg="url(/img/hero_background.png)"
          />

          <div
            ref={heroDragonRef}
            className="absolute inset-x-0 top-20 bottom-20 bg-center bg-no-repeat bg-contain z-10 animate-fade-in-up"
            data-bg="url(/img/dragon_header.png)"
            style={{
              filter: 'drop-shadow(0 0 15px rgba(255, 100, 0, 0.6)) drop-shadow(0 0 30px rgba(255, 100, 0, 0.4)) drop-shadow(0 0 45px rgba(255, 100, 0, 0.2))'
            }}
          />

          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/5 z-5" />

          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-center">
            <h1 className="text-xl font-semibold text-white mb-2" style={{ fontFamily: 'Cinzel, serif', letterSpacing: '0.02em' }}>
              Platforma do analizy rynku serwerów prywatnych
            </h1>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16 space-y-8 relative z-10">
        <section id="servers-section" className="flex justify-center animate-fade-in-up">
          <div className="w-full max-w mx-4">
            <div className="mb-4 text-center">
              <h2 className="fantasy-heading fantasy-heading-large text-[hsl(45_70%_60%)] mb-2 hover:text-[hsl(45_70%_70%)] transition-all duration-300 cursor-default hover:scale-105">
                Dostępne Serwery
              </h2>
              <div className="relative mx-auto">
                <div className="w-32 h-1 bg-gradient-to-r from-transparent via-[hsl(45_70%_60%)] to-transparent mx-auto rounded-full shadow-[0_0_10px_hsl(45_70%_60%_/_0.6)]"></div>
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-2 h-1 bg-[hsl(45_70%_60%)] rounded-full shadow-[0_0_8px_hsl(45_70%_60%_/_0.8)]"></div>
              </div>
            </div>

            <div style={{ height: 480 }}>
              <div className="simple-container">
                <div className="px-4 md:px-6 overflow-y-auto custom-scrollbar" style={{ height: '100%' }}>
                  {loadingHome ? (
                    <div className="pt-6 text-sm text-muted-foreground">Ładowanie...</div>
                  ) : homeError ? (
                    <div className="pt-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{homeError}</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-4 pb-12">
                      {servers.map((server) => (
                        <ServerCard
                          key={server.id}
                          server={server}
                          onClick={() => navigate(`/server/${server.id}`)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="news-section" className="flex flex-col lg:flex-row gap-8 mt-24 md:mt-36 lg:mt-48 xl:mt-56 animate-fade-in" style={{ minHeight: '600px' }}>
          <div className="flex-1">
            <NewsSection news={news} />
          </div>
          <div className="flex-1">
            <VotingSection candidates={candidates} />
          </div>
        </section>

        <section id="faq-section" className="animate-fade-in-up">
          <FAQSection faqs={faqs} />
        </section>
      </div>
    </div>
  );
};

export default Index;
