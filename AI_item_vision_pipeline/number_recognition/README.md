# 🔢 Quantity Recognition (Template Matching OCR)

This folder contains the **third and final stage** of the Metin2 item-recognition pipeline - the module that reads *how many* of an item are in a stack.

After YOLO finds *where* the slots are and CNN identifies *what* item each slot contains, this stage reads the number printed in the bottom-right corner of the icon.

> **Why this is surprisingly non-trivial:** the digit overlay is tiny, lives on top of pixel-art, and must be read perfectly - a misread "100" vs "1000" changes the calculated inventory value by 10×.

---

## 🌟 At a Glance

```
Icon crop (32×32)
        │
        ▼
┌───────────────────────────────────────┐
│  Crop bottom strip (quantity region)  │
│  → Grayscale → Binarize              │
└───────────────────┬───────────────────┘
                    │ binary digit blobs
                    ▼
┌───────────────────────────────────────┐
│  Find contours → sort left→right      │
│  → Template match each ROI vs 0..9    │
│  (OpenCV TM_SQDIFF_NORMED)            │
└───────────────────┴───────────────────┘
                    │
                    ▼
             quantity (int)
```

| Property | Value |
|---|---|
| Method | **Template Matching** (OpenCV `TM_SQDIFF_NORMED`) |
| Input | 32×32 icon crop |
| Templates | Digit PNGs `0.png` … `9.png` |
| Accuracy | **100%** on tested servers (same font/rendering) |
| Speed | Near-instant (CPU, no model inference) |
| New font support | Ship a new template set - no retraining |

---

## 🚀 Why Template Matching instead of a CNN?

> **"How many are there?"**

The natural instinct might be to train a small digit-recognition CNN (MNIST-style). I did try that approach early on - and it produced too many false positives on icon art.

**Why strict template matching wins here:**

| CNN / Neural OCR | Template Matching (this project) |
|---|---|
| Needs training data | No training needed |
| Can misfire on pixel-art backgrounds | Only matches known pixel-exact digit shapes |
| Black-box confidence scores | Deterministic: 0.0 = perfect match |
| Adds model weight | Zero model weight, zero inference overhead |
| Overkill for a fixed font | **100% accurate** when the font is fixed |

The key insight: Metin2's quantity font is **pixel-perfect and consistent** across the servers tested. The digits are rendered in the same color, on the same brown background, in the same font. Under these constraints, strict 1:1 template matching is not just good enough - it's optimal.

---

## 🔍 How It Works Step by Step

```python
# 1. Crop only the bottom part of the icon  (where quantity lives)
bottom_strip = icon[crop_y:, :]

# 2. Grayscale + fixed-threshold binarization
gray = cv2.cvtColor(bottom_strip, cv2.COLOR_BGR2GRAY)
_, binary = cv2.threshold(gray, THRESHOLD, 255, cv2.THRESH_BINARY)

# 3. Find external contours (= digit blobs)
contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

# 4. Sort contours left → right
contours = sorted(contours, key=lambda c: cv2.boundingRect(c)[0])

# 5. For each contour ROI, match against every digit template
for contour in contours:
    x, y, w, h = cv2.boundingRect(contour)
    roi = binary[y:y+h, x:x+w]
    best_digit = match_against_templates(roi)   # TM_SQDIFF_NORMED, lower = better
    result.append(best_digit)

# "1", "0", "0", "0"  →  "1000"
quantity = int("".join(result))
```

The sort step (left → right) is what correctly assembles multi-digit numbers like `1000` or `200` from individual digit blobs.

---

## 🖼️ What the Templates Look Like

The templates are small binary images of each digit extracted directly from in-game screenshots:

| 1 | 2 | 5 | 7 | 9 |
|:---:|:---:|:---:|:---:|:---:|
| ![](docs/images/digit_1.png) | ![](docs/images/digit_2.png) | ![](docs/images/digit_5.png) | ![](docs/images/digit_7.png) | ![](docs/images/digit_9.png) |

At runtime, each detected digit ROI is resized to match the template dimensions before scoring. The strict size requirement is what makes matching both reliable and brittle at the same time (see Limitations).

---

## 📈 Performance

On all tested servers (same client rendering, same font):

| Metric | Value |
|---|---|
| Accuracy | **100%** |
| Speed | Near-instant per icon (no DL inference) |
| CPU usage | Negligible |
| False positive rate | 0% (no quantity box = no contours found) |

> Result: if no digits are detected in the bottom strip, the module returns `None` - the item is treated as a single unit (quantity = 1), which is the correct default for unstacked items.

---

## 🌍 Web-Friendly by Design

| Property | Value |
|---|---|
| Model weight | **0 MB** (no neural network) |
| Additional dependencies | OpenCV only |
| New server support | Ship a new `number_templates/` folder |
| Multi-resolution support | Add a template set per UI scale |

---

## 📁 Folder Structure

```
number_recognition/
├── number_reader.py            # NumberReader - main implementation
├── number_templates/           # Digit templates: 0.png … 9.png
│   ├── 0.png
│   ├── 1.png
│   └── ...
├── demo_read_quantity.py       # CLI demo: read quantity from a single icon
└── docs/
    └── images/                 # Digit template visuals for documentation
```

**Key files:** `number_reader.py` · `number_templates/` · `demo_read_quantity.py`

---

## 🔮 What's Next

Possible improvements if the project evolves further:

- **Multi-resolution template sets** - detect the game's UI scale automatically and select the matching template set, making the module robust to `1.0×` / `1.5×` / `2.0×` UI scaling.
- **Font auto-extraction tool** - given a new game client, extract digit templates automatically instead of hand-picking them.
- **Confidence threshold** - expose the best match score so the pipeline can flag uncertain reads instead of silently returning a wrong digit.
- **Fallback OCR** - for servers with non-standard fonts, fall back to a lightweight CRNN trained on game screenshots rather than failing entirely.

---

## 🛡️ Known Limitations

| Limitation | Root Cause | Mitigation |
|---|---|---|
| Breaks on UI scaling | Template size must match the rendered digit size exactly | Add template sets per UI scale |
| Server-specific fonts | Different clients may use different digit renderings | Ship a per-server template folder |
| No "uncertain" signal | Match accepts the lowest-score template even if all scores are poor | Add max-score threshold + flag |
| Bottom-right region assumed | Only works for standard Metin2 inventory UI layout | Adjust crop coordinates per window type |

---

**Part of the Metin2 Item-Recognition Pipeline.**  
← Back to the [pipeline overview](../README.md) · Previous stage: [Icon Recognition](../cnn/README.md)
