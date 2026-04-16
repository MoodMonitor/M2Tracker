import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, RefreshCw, Home, Bug, Send } from 'lucide-react';
import TurnstileWidget, { TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { errorReporter } from '@/lib/errorReporter';
import { sendFeedback } from '@/services/apiService';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  showDetails?: boolean;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  retryCount: number;
  userComment: string;
  turnstileToken: string | null;
  reportId: string | null;
  commentSent: boolean;
  isSendingComment: boolean;
  reportStatus: 'idle' | 'preparing' | 'sending' | 'sent' | 'error';
  needsVerification: boolean;
  autoSend?: boolean;
}

/**
 * Global Error Boundary component that catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI instead of crashing the entire application.
 */
export class ErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: NodeJS.Timeout | null = null;
  private turnstileRef = React.createRef<TurnstileWidgetHandle>();

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      retryCount: 0,
      userComment: '',
      turnstileToken: null,
      reportId: null,
      commentSent: false,
      isSendingComment: false,
      reportStatus: 'idle',
      needsVerification: false,
      autoSend: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Disable auto-reporting in errorReporter — this component takes full ownership of the report flow
    errorReporter.setAutoReporting(false);

    // Clear any pending timers set by global handlers just before this error
    errorReporter.clearPendingTimers();

    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({ error, errorInfo });

    if (import.meta.env.PROD || error.message.includes('Critical test error from DevErrorTrigger')) {
      this.setState({
        autoSend: true,
        needsVerification: true,
        reportStatus: 'preparing',
      });

      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  componentWillUnmount() {
    // Restore auto-reporting when unmounting
    if (!errorReporter.isAutoReportingEnabled()) {
      errorReporter.setAutoReporting(true);
    }
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    // If we just enabled auto-send and verification, and the Turnstile widget is ready, execute it.
    if (this.state.autoSend && this.state.needsVerification && !prevState.needsVerification) {
      // Give the widget a moment to mount and become ready, then execute
      setTimeout(() => {
        this.turnstileRef.current?.execute();
      }, 100);
    }
  }

  // Called on page unload as a last-resort fallback; main path is handleCommentTurnstileVerify
  sendCommentIfPresent = () => {
    const { userComment, reportId, commentSent } = this.state;
    if (userComment.trim().length >= 10 && this.state.turnstileToken && !commentSent) {
        const payload = {
            category: 'unexpected_problem_comment' as const,
            comment: userComment.trim(),
            turnstileToken: this.state.turnstileToken,
            context: { parentReportId: reportId }
        };
        sendFeedback(payload);
        this.setState({ commentSent: true });
    }
  };

  handleRetry = () => {
    this.sendCommentIfPresent();
    const newRetryCount = this.state.retryCount + 1;

    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      retryCount: newRetryCount,
    });

    errorReporter.setAutoReporting(true);

    if (newRetryCount > 1) {
      const delay = Math.min(1000 * Math.pow(2, newRetryCount - 2), 10000);
      this.retryTimeoutId = setTimeout(() => {
        this.setState({ retryCount: 0 });
      }, delay);
    }
  };

  handleBeforeUnload = () => {
    this.sendCommentIfPresent();
  };

  handleReload = () => {
    this.sendCommentIfPresent();
    // Re-enable global reporting before reload
    errorReporter.setAutoReporting(true);
    window.location.reload();
  };

  handleGoHome = () => {
    this.sendCommentIfPresent();
    // Re-enable global reporting before navigation
    errorReporter.setAutoReporting(true);
    window.location.href = '/';
  };

  handleSendReport = () => {
    if (this.state.reportStatus !== 'idle') return;
    this.setState({ needsVerification: true, reportStatus: 'preparing' }, () => {
      try { this.turnstileRef.current?.execute(); } catch { /* ignore */ }
    });
  };

  handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({ userComment: e.target.value });
  };

  handleSendCommentClick = () => {
    if (this.state.isSendingComment || this.state.commentSent) return;

    this.setState({ isSendingComment: true });
    // Reset and execute Turnstile again for the comment flow.
    this.turnstileRef.current?.reset();
    setTimeout(() => {
      this.turnstileRef.current?.execute();
    }, 100);
  };

  handleCommentTurnstileVerify = (token: string) => {
    const { userComment, reportId } = this.state;
    sendFeedback({
      category: 'unexpected_problem_comment',
      comment: userComment.trim(),
      turnstileToken: token,
      context: { parentReportId: reportId }
    });
    this.setState({ commentSent: true, isSendingComment: false });
  };

  handleTurnstileVerify = (token: string) => {
    this.setState({ reportStatus: 'sending', turnstileToken: token });

    try {
      const reportId = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const context: Record<string, any> = {
        reportId,
        fatalReactError: true,
        name: this.state.error?.name,
        message: this.state.error?.message,
        stack: this.state.error?.stack,
        componentStack: this.state.errorInfo?.componentStack,
        turnstileVerified: !!token,
        turnstileToken: token,
      };

      const res = errorReporter.reportManual('React fatal error report', { ...context });
      
      if (res?.success) {
        this.setState({ reportStatus: 'sent', reportId });
      } else {
        this.setState({ reportStatus: 'error' });
      }
    } catch {
      this.setState({ reportStatus: 'error' });
    }
  };

  handleTurnstileError = (_err: string) => {
    this.setState({ reportStatus: 'error', needsVerification: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, retryCount, reportStatus, userComment } = this.state;
      const { showDetails = import.meta.env.DEV } = this.props;

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-[#0B1119]">
          <Card className="w-full max-w-2xl border-destructive/20 bg-[#0B1119]/95 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 rounded-full bg-destructive/10">
                <AlertTriangle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-xl text-foreground">
                Wystąpił nieoczekiwany błąd
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Przepraszamy za niedogodności. Aplikacja napotkała problem, który uniemożliwia jej dalsze działanie.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 rounded-md bg-destructive/5 border border-destructive/20">
                  <p className="text-sm font-medium text-destructive">
                    {error.name}: {error.message}
                  </p>
                </div>
              )}

              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-sm text-amber-200">
                {reportStatus === 'sent' || reportStatus === 'sending'
                  ? 'Dziękujemy! Raport został wysłany. Możesz teraz dodać opcjonalny komentarz.' :
                 reportStatus === 'error'
                  ? 'Wystąpił błąd podczas wysyłania raportu. Mimo to, spróbuj opisać problem.' :
                 reportStatus === 'preparing' || reportStatus === 'idle'
                  ? 'Przygotowuję bezpieczne połączenie do wysłania raportu...'
                  : 'Problem został automatycznie zgłoszony. Jeśli chcesz, możesz dodać poniżej komentarz, aby nam pomóc.'}
              </div>

              {reportStatus === 'sent' && (
                <div className="space-y-2 pt-4 border-t border-border/50">
                  <label htmlFor="error-comment" className="text-sm font-medium text-muted-foreground">
                    Chcesz nam pomóc bardziej? Opisz co się stało (opcjonalne)
                  </label>
                  <Textarea
                    id="error-comment"
                    value={userComment}
                    onChange={this.handleCommentChange}
                    className="bg-background/50"
                    placeholder="Każda informacja jest cenna..."
                    disabled={reportStatus === 'preparing' || reportStatus === 'idle' || this.state.commentSent}
                  />
                  <div className="flex justify-center">
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={this.handleSendCommentClick}
                      disabled={userComment.trim().length < 10 || this.state.commentSent || this.state.isSendingComment}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {this.state.commentSent ? 'Komentarz wysłany' : (this.state.isSendingComment ? 'Weryfikacja...' : 'Wyślij komentarz')}
                    </Button>
                  </div>
                </div>
              )}

              {retryCount > 0 && (
                <div className="p-3 rounded-md bg-warning/5 border border-warning/20">
                  <p className="text-sm text-warning">
                    Próby naprawy: {retryCount}
                    {retryCount > 2 && " (kolejne próby będą opóźnione)"}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-border/50">
                {!this.state.autoSend && (
                  <Button
                    onClick={this.handleSendReport}
                    className="flex-1"
                    disabled={reportStatus !== 'idle'}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {
                      reportStatus === 'sent' ? 'Zgłoszono' :
                      reportStatus === 'preparing' ? 'Przygotowywanie...' :
                      reportStatus === 'error' ? 'Błąd weryfikacji' :
                      'Wyślij raport'
                    }
                  </Button>
                )}

                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="flex-1"
                  disabled={retryCount > 5}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {retryCount > 5 ? 'Zbyt wiele prób' : 'Spróbuj ponownie'}
                </Button>

                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="flex-1"
                >
                  <Home className="h-4 w-4 mr-2" />
                  Wróć do strony głównej
                </Button>
              </div>

              {/* Hidden Turnstile for secure report submission */}
              {this.state.needsVerification && (
                <div style={{ position: 'absolute'}}>
                  <TurnstileWidget
                    ref={this.turnstileRef}
                    onVerify={(token) => {
                      if (this.state.isSendingComment) this.handleCommentTurnstileVerify(token);
                      else this.handleTurnstileVerify(token);
                    }}
                    onError={this.handleTurnstileError}
                    action="react_fatal_report"
                    variant="invisible"
                    appearance="interaction-only"
                    size="normal"
                  />
                </div>
              )}

              {showDetails && error && errorInfo && (
                <details className="mt-6">
                  <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <Bug className="h-4 w-4" />
                    Szczegóły techniczne
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium mb-1">Stack Trace:</h4>
                      <pre className="text-xs p-3 rounded-md bg-muted/50 overflow-x-auto whitespace-pre-wrap">
                        {error.stack}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-1">Component Stack:</h4>
                      <pre className="text-xs p-3 rounded-md bg-muted/50 overflow-x-auto whitespace-pre-wrap">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  </div>
                </details>
              )}

              <div className="text-xs text-muted-foreground pt-4 border-t border-border/50">
                <p>
                  Jeśli problem się powtarza, spróbuj wyczyścić cache przeglądarki lub skontaktuj się z administratorem.
                </p>
                {import.meta.env.DEV && (
                  <p className="mt-1 text-warning">
                    Tryb deweloperski: Szczegóły błędu są widoczne w konsoli przeglądarki.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based wrapper for functional components that need error boundary functionality
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<Props, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;
  return WrappedComponent;
}

/**
 * Simple error boundary for specific sections that just shows an inline error message
 */
export function SimpleErrorBoundary({ 
  children, 
  message = "Wystąpił błąd w tej sekcji" 
}: { 
  children: ReactNode; 
  message?: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="flex items-center justify-center p-8 border border-destructive/20 rounded-lg bg-destructive/5">
          <div className="text-center">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">{message}</p>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
