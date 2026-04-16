import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

/**
 * Dev-only button that triggers a render-phase error to test the ErrorBoundary.
 */
export const DevErrorTrigger: React.FC = () => {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error('Critical test error from DevErrorTrigger');
  }

  if (!import.meta.env.DEV) return null;

  return (
    <Button size="sm" variant="destructive" onClick={() => setShouldThrow(true)} className="opacity-80 hover:opacity-100">
      <AlertTriangle className="mr-2" /> Wywołaj Błąd Krytyczny (DEV)
    </Button>
  );
};