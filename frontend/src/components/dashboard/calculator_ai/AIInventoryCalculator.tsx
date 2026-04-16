import React, { useReducer, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, AlertCircle, Zap } from 'lucide-react';
import { UploadStage } from './UploadStage';
import { webWorkerManager, type FetchApiMessage } from '@/webWorker/webWorkerManager.ts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { eventBus } from '@/lib/eventBus.ts';
import { type AIFeedbackData, type DetectionBox, type RecognitionResult, type UserFeedbackActions, type AICalcWorkerResponse, type AIAllInOneResponse, type AIDetectResponse, type AIRecognizeResponse } from '@/types/ai';
import { VerifySlotsStage } from './VerifySlotsStage';
import { VerifyItemsStage } from './VerifyItemsStage';
import { SummaryStage, type SummaryItem } from './SummaryStage';
import { getAiCalculatorPrices, sendAIFeedback } from '@/services/apiService';
import type { AICalculatorItemIn, ServerCurrency } from '@/types/api';

// Worker request types
interface AIDetectSlotsRequest extends FetchApiMessage {
  type: 'AI_CALC_DETECT_SLOTS';
  imageBitmap: ImageBitmap;
  serverName: string;
}
interface AIRecognizeItemsRequest extends FetchApiMessage {
  type: 'AI_CALC_RECOGNIZE_ITEMS';
  imageBitmap: ImageBitmap;
  detections: DetectionBox[];
  serverName: string;
}
interface AIAllInOneRequest extends FetchApiMessage {
  type: 'AI_CALC_ALL_IN_ONE';
  imageBitmap: ImageBitmap;
  serverName: string;
}

const APP_VERSION = import.meta.env.PACKAGE_VERSION || '0.0.0';

const MAX_SLOTS_LIMIT = 45;
const MAX_FILE_SIZE_MB = 1;
const MAX_IMAGE_DIMENSION = 800;
const MIN_ITEM_QUANTITY = 1;
const MAX_ITEM_QUANTITY = 999;

const ERROR_HIDE_TIMEOUT = 10000;
const FEEDBACK_RESET_TIMEOUT = 4000;
const DEMO_FETCH_TIMEOUT = 15000;
const WORKER_TIMEOUT_SHORT = 30000;
const WORKER_TIMEOUT_LONG = 120000;

const sanitizeQuantity = (quantity: number): number => {
  if (!Number.isFinite(quantity)) return MIN_ITEM_QUANTITY;
  const normalized = Math.trunc(quantity);
  return Math.min(MAX_ITEM_QUANTITY, Math.max(MIN_ITEM_QUANTITY, normalized));
};

type Stage = 'upload' | 'verify_slots' | 'verify_items' | 'summary';

interface AIState {
  stage: Stage;
  imageFile: File | null;
  isLoading: boolean;
  loadingMessage: string | null;
  error: string | null;
  skipSteps: boolean;
  isDemoMode: boolean;
  detections: DetectionBox[];
  originalItemResults: RecognitionResult[];
  itemResults: RecognitionResult[];
  summaryResults: SummaryItem[];
  userActions: UserFeedbackActions;
  feedbackStatus: 'idle' | 'loading' | 'success' | 'error';
}

type AIAction =
  | { type: 'START_LOADING'; payload?: string }
  | { type: 'STOP_LOADING' }
  | { type: 'SET_UPLOAD_ERROR'; payload: string }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SKIP_STEPS'; payload: boolean }
  | { type: 'START_DEMO'; payload: File }
  | { type: 'SET_IMAGE_FILE'; payload: File }
  | { type: 'ALL_IN_ONE_COMPLETE'; payload: { detections: DetectionBox[]; results: RecognitionResult[] } }
  | { type: 'DETECTION_COMPLETE'; payload: DetectionBox[] }
  | { type: 'RECOGNITION_COMPLETE'; payload: RecognitionResult[] }
  | { type: 'PRICING_COMPLETE'; payload: SummaryItem[] }
  | { type: 'UPDATE_DETECTIONS'; payload: DetectionBox[] }
  | { type: 'REMOVE_SUMMARY_ITEM'; payload: string }
  | { type: 'UPDATE_ITEM_RESULTS'; payload: RecognitionResult[] }
  | { type: 'LOG_USER_ACTION'; payload: Partial<UserFeedbackActions> }
  | { type: 'SET_FEEDBACK_STATUS'; payload: AIState['feedbackStatus'] }
  | { type: 'GO_TO_STAGE'; payload: Stage }
  | { type: 'RESET' };

const initialState: AIState = {
  stage: 'upload',
  imageFile: null,
  isLoading: false,
  loadingMessage: null,
  error: null,
  skipSteps: false,
  isDemoMode: false,
  detections: [],
  originalItemResults: [],
  itemResults: [],
  summaryResults: [],
  userActions: { itemCorrections: [], quantityCorrections: [], deletedDetections: [] },
  feedbackStatus: 'idle',
};

function aiReducer(state: AIState, action: AIAction): AIState {
  switch (action.type) {
    case 'START_LOADING':
      return { ...state, isLoading: true, loadingMessage: action.payload || null, error: null };
    case 'STOP_LOADING':
      return { ...state, isLoading: false, loadingMessage: null };
    case 'SET_UPLOAD_ERROR':
      return { ...state, isLoading: false, error: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'SET_SKIP_STEPS':
      return { ...state, skipSteps: action.payload };
    case 'START_DEMO':
      return { ...initialState, imageFile: action.payload, isLoading: true, isDemoMode: true };
    case 'SET_IMAGE_FILE':
      return { ...initialState, imageFile: action.payload, isLoading: true, isDemoMode: false };
    case 'ALL_IN_ONE_COMPLETE':
      return {
        ...state,
        detections: action.payload.detections,
        originalItemResults: action.payload.results,
        itemResults: action.payload.results,
      };
    case 'DETECTION_COMPLETE':
      return { ...state, detections: action.payload, isLoading: false, stage: 'verify_slots', isDemoMode: state.isDemoMode };
    case 'RECOGNITION_COMPLETE':
      return {
        ...state,
        originalItemResults: action.payload,
        itemResults: action.payload,
        isLoading: false,
        stage: 'verify_items',
        isDemoMode: state.isDemoMode,
      };
    case 'PRICING_COMPLETE':
      return { ...state, summaryResults: action.payload, isLoading: false, stage: 'summary', isDemoMode: state.isDemoMode };
    case 'UPDATE_DETECTIONS':
      return { ...state, detections: action.payload };
    case 'REMOVE_SUMMARY_ITEM':
      return { ...state, summaryResults: state.summaryResults.filter((item) => item.boxId !== action.payload) };
    case 'UPDATE_ITEM_RESULTS':
      return { ...state, itemResults: action.payload };
    case 'LOG_USER_ACTION':
      return { ...state, userActions: { ...state.userActions, ...action.payload } };
    case 'SET_FEEDBACK_STATUS':
      return { ...state, feedbackStatus: action.payload, error: action.payload === 'error' ? state.error : null };
    case 'GO_TO_STAGE':
      return { ...state, stage: action.payload, error: null };
    case 'RESET':
      // Preserve skipSteps, demoMode and imageFile across reset
      return { ...initialState, skipSteps: state.skipSteps, isDemoMode: state.isDemoMode, imageFile: state.imageFile };
    default:
      return state;
  }
}

export function AIInventoryCalculator({ currencies }: { currencies?: ServerCurrency[] }) {
  const { serverId } = useParams<{ serverId: string }>();
  const [state, dispatch] = useReducer(aiReducer, initialState);
  const requestIdRef = useRef(0);
  const priceRequestIdRef = useRef(0);

  const {
    stage,
    imageFile,
    isLoading,
    loadingMessage,
    error,
    skipSteps,
    isDemoMode,
    detections,
    originalItemResults,
    itemResults,
    summaryResults,
    userActions,
    feedbackStatus,
  } = state;

  const setErrorWithTimeout = useCallback(
    (message: string, delay: number = ERROR_HIDE_TIMEOUT) => {
      dispatch({ type: 'SET_ERROR', payload: message });
      setTimeout(() => dispatch({ type: 'SET_ERROR', payload: null }), delay);
    },
    [dispatch]
  );

  // Reset state when server changes
  useEffect(() => {
    requestIdRef.current += 1;
    priceRequestIdRef.current += 1;
    dispatch({ type: 'RESET' });
  }, [serverId]);

  // Unblock UI if session expired while loading
  useEffect(() => {
    const handleSessionExpired = () => {
      if (isLoading) {
        setErrorWithTimeout('Sesja wygasła i została odnowiona. Spróbuj ponownie.', 13000);
      }
    };

    const unsubscribe = eventBus.on('session:expired', handleSessionExpired);
    return () => unsubscribe();
  }, [isLoading, setErrorWithTimeout]);

  // Handle paste (Ctrl+V) on upload stage
  const handlePaste = (event: React.ClipboardEvent) => {
    if (stage !== 'upload' || isLoading) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          event.preventDefault();
          handleFileAccepted(file);
          break;
        }
      }
    }
  };

  const createPriceMap = (priceResponse: { vid: number | null; name: string; price_q10: number | null }[]) => {
    const norm = (s: string) => s.trim().toLowerCase();
    const priceMap = new Map<string | number, number | null>();
    priceResponse.forEach((p) => {
      if (p.vid != null) priceMap.set(p.vid, p.price_q10);
      if (p.name) priceMap.set(norm(p.name), p.price_q10);
    });
    return priceMap;
  };

  const getPriceFromMap = (priceMap: Map<string | number, number | null>, vid: number | null, name: string) => {
    const norm = (s: string) => s.trim().toLowerCase();
    if (vid != null) {
      const price = priceMap.get(vid);
      if (price !== undefined) return price;
    }
    return priceMap.get(norm(name)) ?? null;
  };

  const fetchPricesAndGoToSummary = useCallback(
    async (itemsToPrice: RecognitionResult[], priceRequestId: number) => {
      const normalizedItems = itemsToPrice.map((item) => ({ ...item, quantity: sanitizeQuantity(item.quantity) }));
      const itemsForApi: AICalculatorItemIn[] = normalizedItems.map((item) => ({
        vid: item.itemVid ?? null,
        name: item.itemVid ? null : item.itemName,
      }));
      const priceResponse = await getAiCalculatorPrices({ server_name: serverId!, items: itemsForApi });
      if (priceRequestId !== priceRequestIdRef.current) return;

      const priceMap = createPriceMap(priceResponse);
      const finalResults: SummaryItem[] = normalizedItems.map((item) => {
        const unitPrice = getPriceFromMap(priceMap, item.itemVid, item.itemName);
        return { ...item, unitPrice, totalPrice: unitPrice != null ? unitPrice * item.quantity : null };
      });
      dispatch({ type: 'PRICING_COMPLETE', payload: finalResults });
    },
    [serverId]
  );

  const handleDemoFile = async () => {
    dispatch({ type: 'START_LOADING', payload: 'Pobieranie obrazu demonstracyjnego...' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEMO_FETCH_TIMEOUT);

    try {
      const serverName = serverId ? decodeURIComponent(serverId) : '';
      const encodedServerName = serverName ? encodeURIComponent(serverName) : '';
      const serverScopedPath = encodedServerName ? `/img/${encodedServerName}/demo-inventory.png` : '/img/demo-inventory.png';

      let response = await fetch(serverScopedPath, { signal: controller.signal });
      if (!response.ok) {
        response = await fetch('/img/demo-inventory.png', { signal: controller.signal });
      }

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Nie udało się załadować obrazu demonstracyjnego.');
      const blob = await response.blob();
      const demoFile = new File([blob], 'demo-inventory.png', { type: 'image/png' });
      dispatch({ type: 'START_DEMO', payload: demoFile });
      handleFileAccepted(demoFile, true);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        dispatch({ type: 'SET_ERROR', payload: 'Pobieranie obrazu demo przekroczyło limit czasu.' });
      } else {
        dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Błąd ładowania demo.' });
      }
    }
  };

  const handleFileAccepted = useCallback(
    (file: File, isDemo: boolean = false) => {
      if (!isDemo) {
        dispatch({ type: 'SET_IMAGE_FILE', payload: file });
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setErrorWithTimeout(`Plik jest zbyt duży. Maksymalny rozmiar to ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = async () => {
        try {
          if (img.naturalWidth > MAX_IMAGE_DIMENSION || img.naturalHeight > MAX_IMAGE_DIMENSION) {
            setErrorWithTimeout(`Obraz ma zbyt duże wymiary. Maksymalny wymiar to ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} pikseli.`);
            return;
          }

          if (skipSteps) {
            dispatch({ type: 'START_LOADING', payload: 'Analiza obrazu (krok 1/3)...' });
            try {
              const reqId = ++requestIdRef.current;
              const imageBitmap = await createImageBitmap(file);
              const response = await webWorkerManager.sendMessage<AICalcWorkerResponse>(
                { type: 'AI_CALC_ALL_IN_ONE', imageBitmap, serverName: serverId! } as AIAllInOneRequest,
                [imageBitmap],
                WORKER_TIMEOUT_SHORT
              );

              if (reqId !== requestIdRef.current) return;

              if (response.type === 'AI_CALC_ALL_IN_ONE_SUCCESS') {
                const { detections, results: workerResults } = response as AIAllInOneResponse;
                const uiResults = processWorkerResults(workerResults);
                dispatch({ type: 'ALL_IN_ONE_COMPLETE', payload: { detections, results: uiResults } });

                const needsVerification = uiResults.some((r) => r.suggestions.length > 1);
                if (needsVerification) {
                  dispatch({ type: 'GO_TO_STAGE', payload: 'verify_items' });
                  setErrorWithTimeout('Wykryto niejednoznaczne przedmioty. Zweryfikuj je, aby kontynuować.');
                } else {
                  dispatch({ type: 'START_LOADING', payload: 'Pobieranie cen (krok 3/3)...' });
                  const priceReqId = ++priceRequestIdRef.current;
                  await fetchPricesAndGoToSummary(uiResults, priceReqId);
                }
              } else {
                throw new Error(response.message || 'All-in-one pipeline failed in worker');
              }
            } catch (error) {
              setErrorWithTimeout(error instanceof Error ? error.message : 'Wystąpił błąd podczas automatycznej analizy.');
            }
          } else {
            dispatch({ type: 'START_LOADING', payload: 'Pobieranie modeli oraz wykrywanie slotów...' });
            try {
              const reqId = ++requestIdRef.current;
              const imageBitmap = await createImageBitmap(file);
              const response = await webWorkerManager.sendMessage<AICalcWorkerResponse>(
                { type: 'AI_CALC_DETECT_SLOTS', imageBitmap, serverName: serverId! } as AIDetectSlotsRequest,
                [imageBitmap],
                WORKER_TIMEOUT_LONG
              );

              if (reqId !== requestIdRef.current) return;

              if (response.type === 'AI_CALC_DETECTION_SUCCESS') {
                dispatch({ type: 'DETECTION_COMPLETE', payload: (response as AIDetectResponse).detections });
              } else {
                throw new Error(response.message || 'Detection failed in worker');
              }
            } catch (error) {
              setErrorWithTimeout(error instanceof Error ? error.message : 'Wystąpił błąd podczas detekcji.');
            }
          }
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      img.onerror = () => {
        setErrorWithTimeout('Nie udało się wczytać pliku obrazu. Upewnij się, że format jest poprawny.');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [skipSteps, serverId, fetchPricesAndGoToSummary, setErrorWithTimeout]
  );

  const renderStageContent = () => {
    switch (stage) {
      case 'verify_slots':
        if (!imageFile) {
          return <div className="text-center p-8 text-red-400">Błąd: Brak pliku obrazu. Wróć do poprzedniego kroku.</div>;
        }
        return (
          <VerifySlotsStage
            imageFile={imageFile}
            detections={detections}
            onRemoveDetection={(id) => {
              const removedDetection = detections.find((d) => d.id === id);
              if (removedDetection) {
                dispatch({
                  type: 'LOG_USER_ACTION',
                  payload: { deletedDetections: [...userActions.deletedDetections, removedDetection] },
                });
              }
              dispatch({ type: 'UPDATE_DETECTIONS', payload: detections.filter((d) => d.id !== id) });
            }}
          />
        );
      case 'verify_items':
        if (!imageFile) {
          return <div className="text-center p-8 text-red-400">Błąd: Brak pliku obrazu. Wróć do poprzedniego kroku.</div>;
        }
        return (
          <VerifyItemsStage
            serverName={serverId || ''}
            imageFile={imageFile}
            detections={detections}
            results={itemResults}
            onRemoveResult={(boxId) => {
              const removedDetection = detections.find((d) => d.id === boxId);
              if (removedDetection) {
                dispatch({
                  type: 'LOG_USER_ACTION',
                  payload: { deletedDetections: [...userActions.deletedDetections, removedDetection] },
                });
              }
              dispatch({ type: 'UPDATE_DETECTIONS', payload: detections.filter((d) => d.id !== boxId) });
              dispatch({ type: 'UPDATE_ITEM_RESULTS', payload: itemResults.filter((r) => r.boxId !== boxId) });
            }}
            onUpdateResult={(boxId, newValue, newQuantity) => {
              const originalResult = originalItemResults.find((r) => r.boxId === boxId);
              const newName = typeof newValue === 'string' ? newValue : newValue.value;
              const newVid = typeof newValue === 'string' ? null : newValue.vid;
              const safeQuantity = sanitizeQuantity(newQuantity);

              if (originalResult) {
                if (originalResult.itemName !== newName || (originalResult.itemVid ?? null) !== (newVid ?? null)) {
                  const existingCorrectionIndex = userActions.itemCorrections.findIndex((c) => c.boxId === boxId);
                  const newCorrections = [...userActions.itemCorrections];
                  const detectionBox = detections.find((d) => d.id === boxId);

                  if (existingCorrectionIndex > -1) {
                    newCorrections[existingCorrectionIndex] = {
                      ...newCorrections[existingCorrectionIndex],
                      finalItemName: newName,
                      finalItemVid: newVid,
                    };
                  } else if (detectionBox) {
                    newCorrections.push({
                      boxId,
                      originalItemName: originalResult.itemName,
                      originalSuggestions: originalResult.suggestions.map((s) => s.name),
                      finalItemName: newName,
                      finalItemVid: newVid,
                      boxCoords: {
                        x: detectionBox.x,
                        y: detectionBox.y,
                        width: detectionBox.width,
                        height: detectionBox.height,
                      },
                    });
                  }
                  dispatch({ type: 'LOG_USER_ACTION', payload: { itemCorrections: newCorrections } });
                }

                if (originalResult.quantity !== safeQuantity) {
                  const existingCorrectionIndex = userActions.quantityCorrections.findIndex((c) => c.boxId === boxId);
                  const newCorrections = [...userActions.quantityCorrections];
                  const detectionBox = detections.find((d) => d.id === boxId);

                  if (existingCorrectionIndex > -1) {
                    newCorrections[existingCorrectionIndex].finalQuantity = safeQuantity;
                  } else if (detectionBox) {
                    newCorrections.push({
                      boxId,
                      itemName: originalResult.itemName,
                      originalQuantity: originalResult.quantity,
                      finalQuantity: safeQuantity,
                      boxCoords: {
                        x: detectionBox.x,
                        y: detectionBox.y,
                        width: detectionBox.width,
                        height: detectionBox.height,
                      },
                    });
                  }
                  dispatch({ type: 'LOG_USER_ACTION', payload: { quantityCorrections: newCorrections } });
                }
              }

              dispatch({
                type: 'UPDATE_ITEM_RESULTS',
                payload: itemResults.map((r) =>
                  r.boxId === boxId ? { ...r, itemName: newName, itemVid: newVid, quantity: safeQuantity } : r
                ),
              });
            }}
          />
        );
      case 'summary':
        if (!imageFile) {
          return <div className="text-center p-8 text-red-400">Błąd: Brak pliku obrazu. Wróć do poprzedniego kroku.</div>;
        }
        return (
          <SummaryStage
            imageFile={imageFile}
            detections={detections}
            results={summaryResults}
            onRemoveItem={(boxId) => dispatch({ type: 'REMOVE_SUMMARY_ITEM', payload: boxId })}
            onCopyAndFeedback={handleSendFeedback}
            feedbackStatus={feedbackStatus}
            feedbackError={error}
            currencies={currencies}
          />
        );
      case 'upload':
      default:
        return null;
    }
  };

  const renderUploadStage = () => {
    if (stage !== 'upload') return null;
    return (
      <div className="shrink-0 p-4 border-t border-[#141B24] bg-[#0B1119]/50 flex flex-col relative">
        {isLoading && (
          <div className="absolute inset-0 bg-[#0B1119]/80 backdrop-blur-sm flex items-center justify-center z-10 animate-fade-in">
            <p className="text-orange-400 font-semibold">{loadingMessage || 'Przetwarzanie...'}</p>
          </div>
        )}
        <UploadStage
          onFileAccepted={handleFileAccepted}
          isLoading={isLoading}
          skipSteps={skipSteps}
          onSkipChange={(v) => dispatch({ type: 'SET_SKIP_STEPS', payload: v })}
          onPaste={handlePaste}
          onDemoClick={handleDemoFile}
        />
      </div>
    );
  };

  const goToPreviousStage = () => {
    if (stage === 'verify_slots') {
      dispatch({ type: 'RESET' });
    } else if (stage === 'verify_items') {
      dispatch({ type: 'GO_TO_STAGE', payload: 'verify_slots' });
    } else if (stage === 'summary') {
      dispatch({ type: 'GO_TO_STAGE', payload: 'verify_items' });
    }
  };

  const handleSendFeedback = async () => {
    if (!imageFile) {
      dispatch({ type: 'SET_ERROR', payload: 'Brak pliku obrazu do wysłania.' });
      dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'error' });
      return;
    }

    if (summaryResults.length === 0) {
      dispatch({ type: 'SET_ERROR', payload: 'Brak wykrytych przedmiotów do wysłania.' });
      dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'error' });
      setTimeout(() => dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'idle' }), FEEDBACK_RESET_TIMEOUT);
      return;
    }

    const headers = 'Przedmiot\tIlość\tWartość jednostkowa\tWartość całkowita';
    const dataRows = summaryResults
      .map((item) => [item.itemName, item.quantity, item.unitPrice ?? 'Brak danych', item.totalPrice ?? 'Brak danych'].join('\t'))
      .join('\n');

    try {
      await navigator.clipboard.writeText(`${headers}\n${dataRows}`);
    } catch {
      // clipboard write failed — not critical
    }

    if (isDemoMode) {
      dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'success' });
      setTimeout(() => dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'idle' }), FEEDBACK_RESET_TIMEOUT);
      return;
    }

    dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'loading' });

    const formatRecognitions = (recs: RecognitionResult[]) =>
      recs.map((r) => ({ ...r, suggestions: r.suggestions.map((s) => s.name) }));

    const feedbackPayload: AIFeedbackData = {
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      serverName: serverId || 'unknown',
      originalRecognitions: formatRecognitions(originalItemResults),
      finalRecognitions: formatRecognitions(itemResults),
      userActions: userActions,
    };

    try {
      await sendAIFeedback({ feedbackData: feedbackPayload, imageBlob: imageFile });
      dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'success' });
      setTimeout(() => dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'idle' }), FEEDBACK_RESET_TIMEOUT);
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Wystąpił nieznany błąd podczas wysyłania.' });
      dispatch({ type: 'SET_FEEDBACK_STATUS', payload: 'error' });
    }
  };

  // Maps worker results to the UI-friendly RecognitionResult structure
  const processWorkerResults = (workerResults: RecognitionResult[]): RecognitionResult[] => {
    return workerResults.map((workerResult) => {
      let itemName = '';
      let itemVid: number | null = null;

      if (workerResult.suggestions.length > 0) {
        const bestSuggestion = workerResult.suggestions[0];
        itemName = bestSuggestion.name;
        const parsedVid = Number(bestSuggestion.itemId);
        itemVid = Number.isFinite(parsedVid) ? parsedVid : null;
      }

      return {
        boxId: workerResult.boxId,
        itemName,
        itemVid,
        quantity: sanitizeQuantity(workerResult.quantity),
        suggestions: workerResult.suggestions,
      };
    });
  };

  const goToNextStage = async () => {
    if (stage === 'verify_slots' && detections.length > MAX_SLOTS_LIMIT) {
      setErrorWithTimeout(`Liczba przedmiotów (${detections.length}) przekracza limit ${MAX_SLOTS_LIMIT}. Usuń nadmiarowe sloty, aby kontynuować.`);
      return;
    }
    if (stage === 'verify_slots' && imageFile) {
      dispatch({ type: 'START_LOADING', payload: 'Rozpoznawanie przedmiotów...' });
      try {
        const reqId = ++requestIdRef.current;
        const imageBitmap = await createImageBitmap(imageFile);
        const response = await webWorkerManager.sendMessage<AICalcWorkerResponse>(
          { type: 'AI_CALC_RECOGNIZE_ITEMS', imageBitmap, detections, serverName: serverId! } as AIRecognizeItemsRequest,
          [imageBitmap],
          WORKER_TIMEOUT_SHORT
        );

        if (reqId !== requestIdRef.current) return;

        if (response.type === 'AI_CALC_RECOGNITION_SUCCESS') {
          const workerResults = (response as AIRecognizeResponse).results;
          const uiResults = processWorkerResults(workerResults);
          dispatch({ type: 'RECOGNITION_COMPLETE', payload: uiResults });
        } else {
          throw new Error(response.message || 'Recognition failed in worker');
        }
      } catch (error) {
        dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Wystąpił błąd podczas rozpoznawania przedmiotów.' });
      }
    }
    if (stage === 'verify_items') {
      const allItemsSelected = itemResults.every((item) => item.itemName.trim() !== '');
      if (!allItemsSelected) {
        setErrorWithTimeout('Proszę wybrać nazwę dla wszystkich nierozpoznanych przedmiotów przed przejściem dalej.');
        return;
      }
      dispatch({ type: 'START_LOADING', payload: 'Pobieranie cen...' });
      const priceReqId = ++priceRequestIdRef.current;
      try {
        await fetchPricesAndGoToSummary(itemResults, priceReqId);
      } catch (error) {
        if (priceReqId !== priceRequestIdRef.current) return;
        dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Wystąpił błąd podczas pobierania cen.' });
        dispatch({ type: 'STOP_LOADING' });
      }
    }
  };

  return (
    <Card className="w-full bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in flex flex-col h-[750px]">
      <CardHeader className="shrink-0">
        <CardTitle className="flex items-center gap-2 text-orange-400 text-2xl font-bold tracking-tight">
          🔥 Kalkulator cen przedmiotów AI 🔥
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-4 min-h-0">
        {stage === 'upload' ? (
          <div className="flex flex-col h-full">
            {error && (
              <Alert className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-auto max-w-md animate-fade-in-down bg-background/95 backdrop-blur-sm" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Błąd</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex-1 rounded-md bg-[#0B1119]/50 p-6 overflow-y-auto custom-scrollbar min-h-0">
              <h3 className="text-lg font-semibold text-slate-200 mb-3">Jak działa Kalkulator AI?</h3>
              <div className="text-sm text-slate-400 leading-relaxed space-y-4">
                <p>
                  Nie masz screenshota? Kliknij <b>„Wypróbuj na przykładzie"</b>, żeby zobaczyć, jak to działa.
                </p>
                <p>
                  Kalkulator analizuje screenshot Twojego ekwipunku (do 800×800 px, max 1 MB, max 45 sloty) i automatycznie wycenia jego zawartość.
                </p>
                <ul className="list-disc list-inside space-y-2 pl-2">
                  <li>
                    <b>Detekcja (YOLO):</b> Wykrywa wszystkie przedmioty na obrazie.
                  </li>
                  <li>
                    <b>Rozpoznawanie (CNN):</b> Identyfikuje każdy przedmiot na podstawie jego ikony.
                  </li>
                  <li>
                    <b>Odczyt ilości (Template Matching):</b> Ten etap jest najbardziej czuły na zmiany wyglądu, więc może nie działać poprawnie na przerobionych screenshotach.
                  </li>
                </ul>
                <p>
                  Cały model w naszych testach osiągnął ponad 99% skuteczności, mimo to, może mieć trudności z bardzo podobnymi do siebie ikonami.
                </p>
                <p>
                  Całość działa lokalnie, w Twojej przeglądarce — szybko, lekko i bez wysyłania danych na serwer.
                </p>
                <p>
                  Model był trenowany na screenshotach z ekwipunku, więc inne okna (np. ulepszanie, wytwarzanie) mogą nie działać poprawnie — choć czasem się udaje, nie ma tu gwarancji.
                </p>
                <p>
                  Na każdym etapie zobaczysz, co zostało wykryte i co możesz poprawić. Jeśli chcesz pominąć weryfikację, zaznacz <b>„Pomiń weryfikację i oblicz od razu"</b>.
                </p>
                <p>
                  Po zakończeniu analizy możesz skopiować wyniki w formacie gotowym do wklejenia np. do Excela, jeśli skorzystasz z tej opcji wyrażasz zgodę na przesłanie swojego screenshota (wraz z poprawkami) na serwer w celu dalszego ulepszania modeli.
                </p>
              </div>
            </div>
            {renderUploadStage()}
          </div>
        ) : (
          <>
            {error && stage === 'verify_slots' && (
              <Alert className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-auto max-w-md animate-fade-in-down bg-background/95 backdrop-blur-sm" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Przekroczono limit</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {error && stage === 'verify_items' && (
              <Alert className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-auto max-w-md animate-fade-in-down bg-background/95 backdrop-blur-sm" variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Niekompletne dane</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="relative flex-1 rounded-md bg-[#0B1119]/50 p-4 min-h-0 h-full">
              <div className="h-full w-full">{renderStageContent()}</div>
            </div>
          </>
        )}
      </CardContent>

      {stage !== 'upload' && (
        <div className="shrink-0 border-t border-[#141B24] p-4 flex justify-between items-center">
          <Button variant="outline" onClick={goToPreviousStage} disabled={isLoading}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Wstecz
          </Button>

          {stage === 'summary' ? (
            <Button onClick={() => dispatch({ type: 'RESET' })}>Zakończ</Button>
          ) : (
            <Button onClick={goToNextStage} disabled={isLoading}>
              {stage === 'verify_items' ? 'Oblicz Wartość' : 'Dalej'}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}