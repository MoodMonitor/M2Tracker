import * as ort from 'onnxruntime-web';
import { readQuantity } from './ocr';
import { endpoints } from '@/config/api';
import { handleFetchApi } from './mainApiHandler';
import { getMainSecureSession } from './session';
import { base64UrlToUint8Array } from '@/lib/crypto-module';

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
}

export interface RecognitionResult {
  boxId: string;
  suggestions: { itemId: string; name: string; score: number }[];
  quantity?: number | string;
}

const YOLO_CONFIG = {
  modelPath: '/models/yolo.onnx',
  inputShape: [1, 3, 640, 640],
  confidenceThreshold: 0.6,
  iouThreshold: 0.5,
  minBoxWidth: 15,
  minBoxHeight: 15,
};

const CNN_CONFIG = {
  modelPath: '/models/cnn.onnx',
  featuresDbMetadataPath: (serverName: string) => `/models/${serverName}/database.json`,
  featuresDbBinaryPath: (serverName: string) => `/models/${serverName}/database.bin`,
  inputSize: 32,
};

let yoloSession: ort.InferenceSession | null = null;
let cnnSession: ort.InferenceSession | null = null;
let aiAssetsDecryptionKey: CryptoKey | null = null;

const serverAssetCache = new Map<string, {
  featuresDb: { embeddings: Float32Array, indexToVid: string[] };
  itemMetadata: Map<string, { name: string }>;
  embeddingMetadata: { embedding_size: number, groups: any[] };
}>();

let areGlobalModelsInitialized = false;

/**
 * Decrypts an asset (e.g. a model) using AES-GCM.
 * Assumes the first 12 bytes are the IV.
 */
async function decryptAsset(encryptedData: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  if (encryptedData.byteLength < 12) {
    throw new Error('Invalid encrypted data: too short to contain IV.');
  }
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

/**
 * Fetches and decrypts the AI assets key from the backend (cached after first fetch).
 */
async function getAIAssetsKey(): Promise<CryptoKey> {
  if (aiAssetsDecryptionKey) return aiAssetsDecryptionKey;

  const mainSession = getMainSecureSession();

  const responsePromise = new Promise<any>((resolve, reject) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data.type === 'FETCH_API_SUCCESS') {
        resolve(event.data.data);
      } else {
        reject(new Error(event.data.body?.detail || event.data.statusText || 'Failed to fetch AI assets key'));
      }
    };
    handleFetchApi(channel.port2, { url: endpoints.aiAssetsKey(), options: {} });
  });

  const { encrypted_key } = await responsePromise;

  if (!encrypted_key) {
    throw new Error('No encrypted_key found in AI assets key response.');
  }

  // Decrypt the AES key using the session encryption key (AES-GCM, IV prepended)
  const encryptedKeyData = base64UrlToUint8Array(encrypted_key);
  const iv = encryptedKeyData.slice(0, 12);
  const ciphertext = encryptedKeyData.slice(12);

  const decryptedKeyData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, mainSession.keyEnc, ciphertext);

  aiAssetsDecryptionKey = await crypto.subtle.importKey(
    'raw',
    decryptedKeyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  return aiAssetsDecryptionKey;
}

/** Initializes YOLO and CNN ONNX sessions (runs once). */
async function initializeGlobalModels() {
  if (areGlobalModelsInitialized) return;
  try {
    const decryptionKey = await getAIAssetsKey();

    const [yoloModel, cnnModel] = await Promise.all([
      fetch(YOLO_CONFIG.modelPath).then(res => res.arrayBuffer()).then(buf => decryptAsset(buf, decryptionKey)),
      fetch(CNN_CONFIG.modelPath).then(res => res.arrayBuffer()).then(buf => decryptAsset(buf, decryptionKey))
    ]);

    ort.env.logLevel = 'verbose';
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

    yoloSession = await ort.InferenceSession.create(yoloModel, { executionProviders: ['wasm'] });
    cnnSession = await ort.InferenceSession.create(cnnModel, { executionProviders: ['wasm'] });
    areGlobalModelsInitialized = true;
  } catch (error) {
    console.error('[AI Processor] Failed to initialize AI models:', error);
    throw error;
  }
}

/**
 * Validates a server name. Only alphanumeric characters, hyphens and underscores
 * are allowed, with a maximum length of 64. This prevents path traversal attacks
 * (e.g. "../admin") because serverName is interpolated directly into asset fetch URLs.
 */
const VALID_SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidServerName(serverName: string): void {
  if (!VALID_SERVER_NAME_RE.test(serverName)) {
    throw new Error(`[AI Processor] Invalid server name: "${serverName}". Only a-z, A-Z, 0-9, _ and - are allowed.`);
  }
}

/**
 * Loads and caches server-specific assets (embeddings, metadata).
 */
async function initializeServerAssets(serverName: string) {
  if (!serverName) throw new Error("Server name is required to initialize AI assets.");
  assertValidServerName(serverName);
  if (serverAssetCache.has(serverName)) return;

  try {
    const decryptionKey = await getAIAssetsKey();

    const [metadataResponse, binaryResponse] = await Promise.all([
      fetch(CNN_CONFIG.featuresDbMetadataPath(serverName)),
      fetch(CNN_CONFIG.featuresDbBinaryPath(serverName))
    ]);

    if (!metadataResponse.ok) throw new Error(`Failed to fetch features metadata for ${serverName}: ${metadataResponse.statusText}`);
    if (!binaryResponse.ok) throw new Error(`Failed to fetch features binary for ${serverName}: ${binaryResponse.statusText}`);

    const [decryptedMetadataBuffer, decryptedBinaryBuffer] = await Promise.all([
      metadataResponse.arrayBuffer().then(buf => decryptAsset(buf, decryptionKey)),
      binaryResponse.arrayBuffer().then(buf => decryptAsset(buf, decryptionKey))
    ]);

    const metadata = JSON.parse(new TextDecoder().decode(decryptedMetadataBuffer));
    const float32Array = new Float32Array(decryptedBinaryBuffer);

    const indexToVid: string[] = [];
    const itemMetadata = new Map<string, { name: string }>();

    for (const group of metadata.groups) {
      indexToVid.push(group[0].vid);
      for (const item of group) {
        itemMetadata.set(item.vid, { name: item.name });
      }
    }

    serverAssetCache.set(serverName, {
      featuresDb: { embeddings: float32Array, indexToVid },
      itemMetadata,
      embeddingMetadata: metadata
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Preprocesses an ImageBitmap into the tensor format required by YOLO.
 * Scales the image with letterbox padding.
 */
function preprocess(imageBitmap: ImageBitmap): { tensor: ort.Tensor, scale: number, padX: number, padY: number } {
  const [modelWidth, modelHeight] = YOLO_CONFIG.inputShape.slice(2);
  const { width: originalWidth, height: originalHeight } = imageBitmap;

  // Guard against absurdly large images that could exhaust worker memory
  if (originalWidth > 800 || originalHeight > 800) {
    throw new Error(`Image dimensions are too large: ${originalWidth}x${originalHeight}`);
  }

  const scale = Math.min(modelWidth / originalWidth, modelHeight / originalHeight);
  const newWidth = Math.round(originalWidth * scale);
  const newHeight = Math.round(originalHeight * scale);
  const padX = (modelWidth - newWidth) / 2;
  const padY = (modelHeight - newHeight) / 2;

  const canvas = new OffscreenCanvas(modelWidth, modelHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get OffscreenCanvas context');

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, modelWidth, modelHeight);
  ctx.drawImage(imageBitmap, padX, padY, newWidth, newHeight);

  const imageData = ctx.getImageData(0, 0, modelWidth, modelHeight);
  const { data } = imageData;
  const totalPixels = modelWidth * modelHeight;
  const tensorData = new Float32Array(3 * totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    tensorData[i] = data[i * 4] / 255;
    tensorData[i + totalPixels] = data[i * 4 + 1] / 255;
    tensorData[i + 2 * totalPixels] = data[i * 4 + 2] / 255;
  }

  return { tensor: new ort.Tensor('float32', tensorData, YOLO_CONFIG.inputShape), scale, padX, padY };
}

/**
 * Non-Maximum Suppression — filters overlapping detections.
 */
function nonMaxSuppression(boxes: number[][], iouThreshold: number): number[][] {
  boxes.sort((a, b) => b[4] - a[4]);
  const selected: number[][] = [];

  while (boxes.length > 0) {
    const best = boxes.shift()!;
    selected.push(best);
    boxes = boxes.filter(box => calculateIoU(best, box) < iouThreshold);
  }
  return selected;
}

function calculateIoU(box1: number[], box2: number[]): number {
  const [x1, y1, w1, h1] = box1;
  const [x2, y2, w2, h2] = box2;

  // Convert from [cx, cy, w, h] to [x1, y1, x2, y2]
  const x1_1 = x1 - w1 / 2, y1_1 = y1 - h1 / 2, x1_2 = x1 + w1 / 2, y1_2 = y1 + h1 / 2;
  const x2_1 = x2 - w2 / 2, y2_1 = y2 - h2 / 2, x2_2 = x2 + w2 / 2, y2_2 = y2 + h2 / 2;

  const interArea = Math.max(0, Math.min(x1_2, x2_2) - Math.max(x1_1, x2_1)) *
                    Math.max(0, Math.min(y1_2, y2_2) - Math.max(y1_1, y2_1));
  const unionArea = w1 * h1 + w2 * h2 - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

/** Runs YOLO detection on an image and returns bounding boxes. */
export async function detectSlots(imageBitmap: ImageBitmap, serverName: string): Promise<DetectionBox[]> {
  await initializeGlobalModels();
  await initializeServerAssets(serverName);

  if (!yoloSession) throw new Error("YOLO session is not available.");
  if (!serverAssetCache.has(serverName)) throw new Error(`Assets for server ${serverName} are not available.`);

  const { tensor, scale, padX, padY } = preprocess(imageBitmap);
  const results = await yoloSession.run({ images: tensor });
  const output = results.output0.data as Float32Array;
  const numDetections = results.output0.dims[2];

  const boxes: number[][] = [];
  for (let i = 0; i < numDetections; i++) {
    const conf = output[4 * numDetections + i];
    if (conf < YOLO_CONFIG.confidenceThreshold) continue;

    const width = output[2 * numDetections + i];
    const height = output[3 * numDetections + i];
    if (width < YOLO_CONFIG.minBoxWidth || height < YOLO_CONFIG.minBoxHeight) continue;

    boxes.push([output[0 * numDetections + i], output[1 * numDetections + i], width, height, conf]);
  }

  const finalBoxes = nonMaxSuppression(boxes, YOLO_CONFIG.iouThreshold);

  // Convert back to original image coordinates and sort top-to-bottom, left-to-right
  return finalBoxes
    .map((box, i) => {
      const [cx, cy, w, h] = box;
      const x = (cx - padX) / scale;
      const y = (cy - padY) / scale;
      const fw = w / scale;
      const fh = h / scale;
      return { id: `box-real-${i}`, x: x - fw / 2, y: y - fh / 2, width: fw, height: fh };
    })
    .sort((a, b) => Math.abs(a.y - b.y) < 10 ? a.x - b.x : a.y - b.y);
}

/** L2-normalizes a vector. */
function normalizeL2(vec: Float32Array | number[]): Float32Array {
  const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vec instanceof Float32Array ? vec : new Float32Array(vec);
  return vec instanceof Float32Array ? vec.map(v => v / magnitude) : new Float32Array(vec.map(v => v / magnitude));
}

/** Dot product of two vectors (cosine similarity when both are L2-normalized). */
function dotProduct(vecA: Float32Array, vecB: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) sum += vecA[i] * vecB[i];
  return sum;
}

/** Runs CNN recognition on detected slots and returns item suggestions. */
export async function recognizeItems(imageBitmap: ImageBitmap, detections: DetectionBox[], serverName: string): Promise<RecognitionResult[]> {
  await initializeGlobalModels();
  await initializeServerAssets(serverName);

  if (!cnnSession) throw new Error("CNN session is not available.");
  const serverAssets = serverAssetCache.get(serverName);
  if (!serverAssets) throw new Error(`Assets for server ${serverName} are not available.`);

  const recognitionResults: RecognitionResult[] = [];

  for (const detection of detections) {
    const roiBitmap = await createImageBitmap(imageBitmap, detection.x, detection.y, detection.width, detection.height);
    const quantity = await readQuantity(roiBitmap);

    const canvas = new OffscreenCanvas(CNN_CONFIG.inputSize, CNN_CONFIG.inputSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(roiBitmap, 0, 0, CNN_CONFIG.inputSize, CNN_CONFIG.inputSize);
    const imageData = ctx.getImageData(0, 0, CNN_CONFIG.inputSize, CNN_CONFIG.inputSize);

    const totalPixels = CNN_CONFIG.inputSize * CNN_CONFIG.inputSize;
    const tensorData = new Float32Array(3 * totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      // ImageNet normalization: (pixel - mean) / std
      tensorData[i] = (imageData.data[i * 4] / 255 - 0.485) / 0.229;
      tensorData[i + totalPixels] = (imageData.data[i * 4 + 1] / 255 - 0.456) / 0.224;
      tensorData[i + 2 * totalPixels] = (imageData.data[i * 4 + 2] / 255 - 0.406) / 0.225;
    }

    const results = await cnnSession.run({ input: new ort.Tensor('float32', tensorData, [1, 3, CNN_CONFIG.inputSize, CNN_CONFIG.inputSize]) });
    const queryEmbedding = normalizeL2(results.output.data as Float32Array);

    const { embeddings: dbEmbeddings, indexToVid } = serverAssets.featuresDb;
    const embeddingSize = serverAssets.embeddingMetadata.embedding_size;

    const similarities = indexToVid.map((vid, i) => ({
      itemId: vid,
      score: dotProduct(queryEmbedding, dbEmbeddings.subarray(i * embeddingSize, i * embeddingSize + embeddingSize))
    })).sort((a, b) => b.score - a.score);

    const bestVid = similarities[0]?.itemId;
    const bestIdx = indexToVid.indexOf(bestVid);
    const bestEmbedding = bestIdx !== -1
      ? dbEmbeddings.subarray(bestIdx * embeddingSize, bestIdx * embeddingSize + embeddingSize)
      : null;

    // Collect all VIDs that share the same embedding (grouped items)
    const allVidsForBest: string[] = [];
    if (bestEmbedding) {
      for (let i = 0; i < indexToVid.length; i++) {
        const ref = dbEmbeddings.subarray(i * embeddingSize, i * embeddingSize + embeddingSize);
        if (dotProduct(bestEmbedding, ref) > 0.999) {
          const group = serverAssets.embeddingMetadata.groups.find((g: any[]) => g.some(item => item.vid === indexToVid[i]));
          if (group) allVidsForBest.push(...group.map((item: any) => item.vid));
        }
      }
    }

    const finalSuggestions = allVidsForBest
      .map(vid => ({
        itemId: vid,
        name: serverAssets.itemMetadata?.get(vid)?.name ?? 'Unknown',
        score: similarities[0]?.score ?? 0
      }))
      .filter((v, i, arr) => arr.findIndex(t => t.itemId === v.itemId) === i)
      .map((s, _, arr) => {
        const hasDupName = arr.some(x => x.name === s.name && x.itemId !== s.itemId);
        return { ...s, name: hasDupName ? `${s.name} (ID: ${s.itemId})` : s.name };
      });

    recognitionResults.push({
      boxId: detection.id,
      suggestions: finalSuggestions.length > 0
        ? finalSuggestions
        : similarities.slice(0, 3).map(m => ({
            ...m,
            name: serverAssets.itemMetadata?.get(m.itemId)?.name ?? 'Unknown'
          })),
      quantity,
    });
  }

  return recognitionResults;
}