/* eslint-disable @typescript-eslint/no-explicit-any */

// This file contains a self-contained implementation for Optical Character Recognition,
// specifically for reading item quantities from slots, without external libraries like OpenCV.js.

/**
 * Type definition for the loaded digit templates.
 * The key is the digit ('0'-'9'), and the value is the template data.
 */
interface DigitTemplate {
  width: number;
  height: number;
  data: number[][]; // Storing as 2D array is simpler for matching
}

let digitTemplates: Map<string, DigitTemplate> | null = null;

const OCR_CONFIG = {
  templatesPath: '/models/number_templates.json',
  thresholdValue: 200,
  minContourArea: 2.0, // A small value to filter out noise
  confidenceThreshold: 0.1, // Lower is better for TM_SQDIFF_NORMED
};

/**
 * Loads the digit templates from a JSON file.
 * This is done only once and the result is cached.
 */
async function initializeOcr(): Promise<void> {
  if (digitTemplates) {
    return;
  }

  const response = await fetch(OCR_CONFIG.templatesPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch digit templates: ${response.statusText}`);
  }
  const templatesData: Record<string, number[][]> = await response.json();

  const loadedTemplates = new Map<string, DigitTemplate>();
  for (const digit in templatesData) {
    const templateArray = templatesData[digit];
    const height = templateArray.length;
    const width = templateArray[0]?.length || 0;
    if (width === 0) continue;
    loadedTemplates.set(digit, { width, height, data: templateArray });
  }

  digitTemplates = loadedTemplates;
}

/**
 * Preprocesses a Region of Interest (ROI) of an item slot to isolate digits.
 * This replicates the logic from the Python script: crop, grayscale, threshold.
 * @param roiBitmap The bitmap of a single item slot.
 * @returns A binarized 2D number array (0 or 255) ready for contour detection.
 */
function preprocessRoi(roiBitmap: ImageBitmap): number[][] {
  const { width, height } = roiBitmap;

  // Create a canvas to manipulate the image
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get OffscreenCanvas context for OCR.');

  // 1. Draw the full ROI to get pixel data
  ctx.drawImage(roiBitmap, 0, 0);
  const fullImageData = ctx.getImageData(0, 0, width, height);

  // 2. Crop to the bottom 45% where numbers are expected
  const cropY = Math.floor(height * 0.55);
  const cropHeight = height - cropY;
  const binarizedGrid: number[][] = Array(cropHeight).fill(0).map(() => Array(width).fill(0));

  // 3. Convert to grayscale and apply binary threshold
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < width; x++) {
      const originalY = y + cropY;
      const i = (originalY * width + x) * 4;
      const r = fullImageData.data[i];
      const g = fullImageData.data[i + 1];
      const b = fullImageData.data[i + 2];
      
      // Simple luminance-based grayscale
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      binarizedGrid[y][x] = gray > OCR_CONFIG.thresholdValue ? 255 : 0;
    }
  }
  return binarizedGrid;
}

/**
 * Finds connected components (contours) in a binarized grid using a flood-fill approach.
 * @param grid A 2D array of 0s and 255s.
 * @returns An array of bounding boxes for each found contour.
 */
function findContours(grid: number[][]): { x: number, y: number, w: number, h: number }[] {
  const height = grid.length;
  if (height === 0) return [];
  const width = grid[0].length;
  const visited = Array(height).fill(0).map(() => Array(width).fill(false));
  const contours = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 255 && !visited[y][x]) {
        // Start of a new component
        let minX = x, maxX = x, minY = y, maxY = y;
        const stack = [[x, y]];
        visited[y][x] = true;
        let area = 0;

        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          area++;
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);

          // Check neighbors (8-connectivity)
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx] && grid[ny][nx] === 255) {
                visited[ny][nx] = true;
                stack.push([nx, ny]);
              }
            }
          }
        }

        if (area > OCR_CONFIG.minContourArea) {
          contours.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
        }
      }
    }
  }
  // Sort contours from left to right
  return contours.sort((a, b) => a.x - b.x);
}

/**
 * Performs template matching using the Sum of Squared Differences (SSD) method.
 * @param roi The region of interest (a 2D array of pixel values).
 * @param template The template to match against.
 * @returns A score where 0 is a perfect match.
 */
function matchTemplate(roi: number[][], template: DigitTemplate): number {
  const roiHeight = roi.length;
  const roiWidth = roi[0].length;

  // Your Python script is very strict: it only matches if shapes are identical. We replicate that.
  if (roiWidth !== template.width || roiHeight !== template.height) {
    return Infinity;
  }

  let ssd = 0;
  for (let y = 0; y < roiHeight; y++) {
    for (let x = 0; x < roiWidth; x++) {
      const diff = roi[y][x] - template.data[y][x];
      ssd += diff * diff;
    }
  }

  // Normalize the score to be consistent with TM_SQDIFF_NORMED
  const norm = Math.sqrt(ssd);
  return norm / (roiWidth * roiHeight); // Simple normalization
}

/**
 * Reads the quantity from an item slot image.
 * @param roiBitmap The bitmap of the item slot.
 * @returns The recognized number, or 1 if not found.
 */
export async function readQuantity(roiBitmap: ImageBitmap): Promise<number> {
  try {
    await initializeOcr();
    if (!digitTemplates) throw new Error("Templates not loaded");

    const binarizedGrid = preprocessRoi(roiBitmap);
    const contours = findContours(binarizedGrid);

    if (!contours || contours.length === 0) {
      return 1;
    }

    let recognizedString = "";
    for (const { x, y, w, h } of contours) {
      // Extract the ROI for the current digit from the binarized grid
      const digitRoi = Array(h).fill(0).map((_, i) => binarizedGrid[y + i].slice(x, x + w));

      let bestMatchDigit = null;
      let bestMatchScore = Infinity;

      for (const [digit, template] of digitTemplates.entries()) {
        const score = matchTemplate(digitRoi, template);
        if (score < bestMatchScore) {
          bestMatchScore = score;
          bestMatchDigit = digit;
        }
      }

      if (bestMatchDigit !== null && bestMatchScore <= OCR_CONFIG.confidenceThreshold) {
        recognizedString += bestMatchDigit;
      }
    }

    const finalNumber = parseInt(recognizedString, 10);
    return isNaN(finalNumber) || finalNumber === 0 ? 1 : finalNumber;
  } catch (error) {
    console.error('[OCR] Failed to read quantity:', error);
    return 1; // Default to 1 on error
  }
}