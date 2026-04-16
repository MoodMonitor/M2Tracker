import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Footer from "@/components/Footer";
import { FeedbackProvider } from "@/context/FeedbackContext";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { errorReporter } from "@/lib/errorReporter";

// Route-level code splitting
const Index = lazy(() => import("./pages/Index"));
const ServerDashboard = lazy(() => import("./pages/ServerDashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ErrorBoundary>
              <div className="min-h-screen bg-gradient-to-br from-background via-background to-background/95 flex flex-col">
                <div className="flex-1">
                  <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading...</div>}>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/server/:serverId" element={<ServerDashboard />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </div>
                <Footer />
              </div>
            </ErrorBoundary>
          </BrowserRouter>
          
          <FeedbackDialog />

        </TooltipProvider>
      </FeedbackProvider>
  </QueryClientProvider>
);

export default App;
