/**
 * Centralized type definitions for AI processing (detection, recognition, and feedback).
 */

// The raw output from the YOLO detection model in the worker.
export interface DetectionBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// The raw output from the CNN recognition model in the worker.
export interface RecognitionResult {
  boxId: string;
  itemName: string; // The best guess for the item name
  itemVid?: number | null; // The best guess for the item VID
  quantity: number;
  suggestions: { itemId: string; name: string; score: number }[]; // All suggestions from the model
}

// --- AI Feedback API Payload ---

// Defines user actions for feedback purposes.
export interface UserFeedbackActions {
  deletedDetections: DetectionBox[];
  itemCorrections: Array<{
    boxId: string;
    originalItemName: string; // The original name recognized by the AI
    originalSuggestions: string[]; // The list of suggestions AI provided
    finalItemName: string;
    finalItemVid: number | null;
    boxCoords: { x: number; y: number; width: number; height: number };
  }>;
  quantityCorrections: Array<{
    boxId: string;
    itemName: string; // The name of the item for context
    originalQuantity: number;
    finalQuantity: number;
    boxCoords: { x: number; y: number; width: number; height: number };
  }>;
}

// The main feedback data object sent to the backend API.
export interface AIFeedbackData {
  version: string;
  timestamp: string; // ISO 8601
  serverName: string;
  originalRecognitions: Array<Omit<RecognitionResult, 'suggestions'> & { suggestions: string[] }>;
  finalRecognitions: Array<Omit<RecognitionResult, 'suggestions'> & { suggestions: string[] }>;
  userActions: UserFeedbackActions;
}

// --- Types for communication with the AI Web Worker ---

export interface AIWorkerErrorResponse {
  type: 'AI_CALC_DETECTION_ERROR' | 'AI_CALC_RECOGNITION_ERROR' | 'AI_CALC_ALL_IN_ONE_ERROR' | 'ERROR';
  message: string;
}

export interface AIDetectResponse {
  type: 'AI_CALC_DETECTION_SUCCESS';
  detections: DetectionBox[];
}

export interface AIRecognizeResponse {
  type: 'AI_CALC_RECOGNITION_SUCCESS';
  results: RecognitionResult[];
}

export interface AIAllInOneResponse extends AIDetectResponse, AIRecognizeResponse {
  type: 'AI_CALC_ALL_IN_ONE_SUCCESS';
}

export type AICalcWorkerResponse = AIDetectResponse | AIRecognizeResponse | AIAllInOneResponse | AIWorkerErrorResponse;