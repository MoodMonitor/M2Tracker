import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TrendingUp, Server, Home, MessageCircleQuestion, Mail, Calendar } from "lucide-react";

interface NavigationProps {
  variant?: 'overlay' | 'standard';
}

export function Navigation({ variant = 'standard' }: NavigationProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (variant === 'overlay') {
    return (
      <nav className="absolute top-6 left-1/2 transform -translate-x-1/2 z-20">
        <div className="flex space-x-8 text-lg font-semibold" style={{ fontFamily: 'Cinzel, serif' }}>
          <button 
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-white hover:text-[hsl(45_80%_65%)] transition-all duration-300 cursor-pointer relative group"
          >
            Strona Główna
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[hsl(45_80%_65%)] transition-all duration-300 group-hover:w-full"></span>
          </button>
          <button 
            onClick={() => scrollToSection('servers-section')}
            className="text-white hover:text-[hsl(45_80%_65%)] transition-all duration-300 cursor-pointer relative group"
          >
            Serwery
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[hsl(45_80%_65%)] transition-all duration-300 group-hover:w-full"></span>
          </button>
          <button 
            onClick={() => scrollToSection('news-section')}
            className="text-white hover:text-[hsl(45_80%_65%)] transition-all duration-300 cursor-pointer relative group"
          >
            Aktualności
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[hsl(45_80%_65%)] transition-all duration-300 group-hover:w-full"></span>
          </button>
          <button 
            onClick={() => scrollToSection('faq-section')}
            className="text-white hover:text-[hsl(45_80%_65%)] transition-all duration-300 cursor-pointer relative group"
          >
            FAQ
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[hsl(45_80%_65%)] transition-all duration-300 group-hover:w-full"></span>
          </button>
          <button 
            onClick={() => scrollToSection('footer')}
            className="text-white hover:text-[hsl(45_80%_65%)] transition-all duration-300 cursor-pointer relative group"
          >
            Kontakt
            <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[hsl(45_80%_65%)] transition-all duration-300 group-hover:w-full"></span>
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav
      className={
        "sticky top-0 z-50 w-full transition-colors duration-300 relative " +
        (scrolled
          ? "bg-background/85 backdrop-blur-md border-b border-white/5 shadow-sm"
          : "bg-transparent border-b border-transparent")
      }
    >
      <span
        className={
          "pointer-events-none absolute inset-0 [background:linear-gradient(90deg,rgba(0,0,0,1)_0%,rgba(0,0,0,0)_15%,rgba(0,0,0,0)_85%,rgba(0,0,0,1)_100%)] transition-opacity " +
          (scrolled ? "opacity-30" : "opacity-20")
        }
      />

      <div className="relative z-10 container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-2 font-bold text-lg">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Metin2 Market
            </span>
          </Link>
          
          <div className="hidden md:flex items-center space-x-4">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/" className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                Strona Główna
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => scrollToSection('servers-section')}>
                <Server className="h-4 w-4" />
                Serwery
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => scrollToSection('news-section')}>
                <Calendar className="h-4 w-4" />
                Aktualności
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => scrollToSection('faq-section')}>
                <MessageCircleQuestion className="h-4 w-4" />
                FAQ
            </Button>
            <Button variant="ghost" size="sm" className="flex items-center gap-2" onClick={() => scrollToSection('footer')}>
                <Mail className="h-4 w-4" />
                Kontakt
            </Button>
          </div>
        </div>

      </div>
      <span
        className={
          "pointer-events-none absolute inset-0 [background:linear-gradient(90deg,rgba(0,0,0,1)_0%,rgba(0,0,0,0)_22%,rgba(0,0,0,0)_78%,rgba(0,0,0,1)_100%)] transition-opacity " +
          (scrolled ? "opacity-30" : "opacity-20")
        }
      />
      {!scrolled && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-px h-8 bg-gradient-to-b from-background/60 to-transparent" />
      )}
    </nav>
  );
}