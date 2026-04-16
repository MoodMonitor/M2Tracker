import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';

interface FeedbackContextType {
  isFeedbackOpen: boolean;
  openFeedbackDialog: () => void;
  closeFeedbackDialog: () => void;
}

const FeedbackContext = createContext<FeedbackContextType | undefined>(undefined);

export const FeedbackProvider = ({ children }: { children: ReactNode }) => {
  const [isFeedbackOpen, setFeedbackOpen] = useState(false);

  const openFeedbackDialog = useCallback(() => setFeedbackOpen(true), []);
  const closeFeedbackDialog = useCallback(() => setFeedbackOpen(false), []);

  return (
    <FeedbackContext.Provider value={{ isFeedbackOpen, openFeedbackDialog, closeFeedbackDialog }}>
      {children}
    </FeedbackContext.Provider>
  );
};

export const useFeedback = (): FeedbackContextType => {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
};