# word_cnn Pipeline — Browser Implementation Verification Spec

This document traces the **complete, exact pipeline** from screen frame capture through
ROI extraction and preprocessing into the `word_cnn` classifier. Every numerical constant,
formula, and operation order is derived from the Python reference implementation. The
browser agent must replicate each step exactly to achieve parity.

Digit/CRNN pipeline is explicitly out of scope.

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Stage 1 — Frame Capture](#2-stage-1--frame-capture)
3. [Stage 2 — Anchor Matching](#3-stage-2--anchor-matching)
4. [Stage 3 — ROI Positioning and Clipping](#4-stage-3--roi-positioning-and-clipping)
5. [Stage 4 — Image Filtering](#5-stage-4--image-filtering)
6. [Stage 5 — Predictor Dispatch](#6-stage-5--predictor-dispatch)
7. [Stage 6 — Preprocessing Inside the Predictor](#7-stage-6--preprocessing-inside-the-predictor)
8. [Stage 7 — Model Architecture](#8-stage-7--model-architecture)
9. [Stage 8 — Post-processing](#9-stage-8--post-processing)
10. [Class Index Table](#10-class-index-table)
11. [ONNX Export Specification](#11-onnx-export-specification)
12. [Common Browser Pitfalls](#12-common-browser-pitfalls)

---

## 1. Pipeline Overview

```
Screen frame (RGBA)
  │ RGBA → BGR
  ▼
BGR frame (numpy H×W×3)
  │ anchor template match → affine transform
  ▼
ROI crop (BGR, variable size, clipped)
  │ brightness / contrast / channel / grayscale / threshold / invert
  ▼
filtered_roi (BGR, grayscale-looking)
  │         ← NOTE: raw_roi (BGR) is what actually enters the predictor
  ▼
word_cnn predictor
  │ BGR → grayscale
  │ contrast guard  (max − min < 100 → return [])
  │ autocrop to text core
  │ resize+pad → 32×256 canvas
  │ normalize ÷255 → float32
  ▼
Tensor  (1, 1, 32, 256)
  │ CNN forward pass
  ▼
Logits  (1, 27)
  │ softmax
  ▼
[(label, confidence), ...]  sorted descending
```

> **Important color-space note:** The predictor always receives the **raw_roi** (BGR),
> not the filtered_roi. The predictor itself performs BGR → grayscale conversion as its
> first step.  The filter stage output is only used for display / debug purposes in the
> Python UI.

---

## 2. Stage 1 — Frame Capture

| Property | Value |
|---|---|
| Capture method | Qt `QScreen.grabWindow()` |
| Output from Qt | `QImage` (RGBA8888) |
| Conversion | `cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)` |
| Frame dtype | `uint8`, shape `(H, W, 3)`, channel order **B G R** |
| Default FPS | 10 |
| Capture interval | `max(1, 1000 // fps)` ms = 100 ms at 10 FPS |

The browser equivalent captures an HTML canvas or video frame. Regardless of source,
the frame must be in **BGR channel order** before any downstream processing, or you
must ensure grayscale conversion in the predictor accounts for the actual channel order
(for pure-grayscale conversion the result is numerically identical to RGB→Gray using
the standard luma formula — see Stage 6 for details).

---

## 3. Stage 2 — Anchor Matching

### Purpose
Locate a known HUD element (anchor image) inside the current frame to establish a
coordinate reference from which ROI positions are calculated.

### Single-Anchor (legacy)

```python
cv2.matchTemplate(search_region_gray, template_gray, cv2.TM_CCOEFF_NORMED)
```

| Parameter | Value |
|---|---|
| Method | `cv2.TM_CCOEFF_NORMED` |
| Multi-scale scan range | 0.5× – 2.0× |
| Number of scale steps | 17 |
| Match threshold (default) | **0.7** (per-profile override possible) |
| Search region | Configurable sub-region of frame or full frame |

Returns: `(found: bool, x: int, y: int, confidence: float, anchor_w: int, anchor_h: int)`

```js
// JS pseudocode
const template = await loadGrayscaleTemplate(templatePath);
for (let s = 0; s < 17; s++) {
  const scale = 0.5 + s * (2.0 - 0.5) / 16; // 17 steps from 0.5 to 2.0
  const scaled = resizeTemplate(template, scale);
  const result = matchTemplate(searchRegionGray, scaled, TM_CCOEFF_NORMED);
  if (result.maxVal > bestVal) { bestVal = result.maxVal; bestLoc = result.maxLoc; }
}
const found = bestVal >= 0.7;
```

### Multi-Anchor (2 or 3 reference points)

Used when the profile provides multiple named anchor points for more accurate affine
alignment (handles HUD scaling and slight rotation across resolutions).

**2-point anchor:**
```python
M, _ = cv2.estimateAffinePartial2D(src_pts, dst_pts)
# M is a 2×3 partial affine matrix (4 DoF: tx, ty, rotation, uniform scale)
```

**3-point anchor:**
```python
M = cv2.getAffineTransform(src_pts, dst_pts)
# M is a 2×3 full affine matrix (6 DoF)
```

**Scale extraction from M:**
```python
scale = math.sqrt(M[0, 0] ** 2 + M[1, 0] ** 2)
```

```js
// JS pseudocode (scale extraction)
const scale = Math.sqrt(M[0][0] ** 2 + M[1][0] ** 2);
```

Returns: `(found: bool, transform M: 2×3 matrix, scale: float, per-anchor results)`

---

## 4. Stage 3 — ROI Positioning and Clipping

### Legacy single-anchor positioning

```python
roi_x = anchor.x + roi_def.x_offset
roi_y = anchor.y + roi_def.y_offset
```

### Multi-anchor positioning

If the ROI references a sub-anchor:
```python
sub_pos = apply_transform(M, sub_anchor_ref_pos)
roi_x = sub_pos[0] + (roi_ref_x - sub_ref_x) * scale
roi_y = sub_pos[1] + (roi_ref_y - sub_ref_y) * scale
```

Otherwise apply transform directly:
```python
pt = apply_transform(M, np.array([roi_ref_x, roi_ref_y]))
roi_x, roi_y = int(pt[0]), int(pt[1])
```

### ROI size

```python
roi_w = round(roi_def.width  * scale)
roi_h = round(roi_def.height * scale)
```

### Clipping (partial off-screen allowed)

```python
slice_x1 = max(0, roi_x)
slice_y1 = max(0, roi_y)
slice_x2 = min(frame_w, roi_x + roi_w)
slice_y2 = min(frame_h, roi_y + roi_h)
raw_roi = frame[slice_y1:slice_y2, slice_x1:slice_x2]   # BGR
```

```js
// JS pseudocode
const x1 = Math.max(0, roiX);
const y1 = Math.max(0, roiY);
const x2 = Math.min(frameW, roiX + roiW);
const y2 = Math.min(frameH, roiY + roiH);
const rawRoi = cropFrame(frame, x1, y1, x2 - x1, y2 - y1); // BGR
```

> **Output:** `raw_roi` is a BGR `uint8` numpy array of shape `(actual_h, actual_w, 3)`.
> This is passed **unmodified** to the word_cnn predictor.

---

## 5. Stage 4 — Image Filtering

Filters are applied to produce `filtered_roi` used for display. The predictor receives
`raw_roi` independently. You still need this stage if your browser UI shows the
preprocessed feed, or if you wire the filtered path into the predictor.

### Operation order (strict — must not be reordered)

| # | Operation | Enabled when | Formula |
|---|---|---|---|
| 1 | Brightness | `brightness != 0` | `cv2.convertScaleAbs(img, alpha=1, beta=brightness)` |
| 2 | Contrast | `contrast != 0` | `alpha = 1 + contrast/100; cv2.convertScaleAbs(img, alpha=alpha, beta=0)` |
| 3 | Channel isolation | `channel != "none"` | Keep selected channel (0=B,1=G,2=R), zero others |
| 4 | Grayscale | `grayscale == true` | `gray = cvtColor(img, BGR2GRAY); img = cvtColor(gray, GRAY2BGR)` |
| 5 | Threshold | `threshold_enabled == true` | `cv2.threshold(gray, threshold_value, 255, THRESH_BINARY)` |
| 6 | Invert | `invert == true` | `cv2.bitwise_not(img)` |

### Default configuration for word ROIs

From `mole_relative_anchors_crnn.json` (typical word_cnn ROI):

```json
"filters": {
  "brightness": 0,
  "contrast": 0,
  "threshold": 127,
  "threshold_enabled": false,
  "grayscale": true,
  "invert": false,
  "channel": "none"
}
```

**Net result:** Only step 4 (grayscale) executes. The output is a BGR image where all
three channels carry the same luminance value.

```js
// JS pseudocode — default word ROI filter
function applyFilters(bgr, filters) {
  let img = bgr.clone();
  if (filters.brightness !== 0) img = convertScaleAbs(img, 1, filters.brightness);
  if (filters.contrast  !== 0) img = convertScaleAbs(img, 1 + filters.contrast / 100, 0);
  if (filters.channel !== "none") img = isolateChannel(img, filters.channel);
  if (filters.grayscale) {
    const gray = cvtColor(img, BGR2GRAY);
    img = cvtColor(gray, GRAY2BGR);
  }
  if (filters.threshold_enabled) {
    const _, th = threshold(img, filters.threshold, 255, THRESH_BINARY);
    img = cvtColor(th, GRAY2BGR);
  }
  if (filters.invert) img = bitwiseNot(img);
  return img;
}
```

---

## 6. Stage 5 — Predictor Dispatch

In `core/pipeline.py::_extract_and_recognize()`:

```python
if roi_def.recognition_mode == "word_cnn":
    if self.word_predictor.is_loaded:
        word_scores = self.word_predictor.predict_all(raw_roi)   # raw_roi is BGR
        text, conf = word_scores[0] if word_scores else ("?", 0.0)
    else:
        word_scores = []
        text = "?"
        conf = 0.0
```

- `predict_all()` returns a list sorted descending by confidence.
- An **empty list** means the contrast guard fired (low-contrast / blank ROI).
- The pipeline treats an empty result as `"?"` with `conf = 0.0`.

---

## 7. Stage 6 — Preprocessing Inside the Predictor

This is the most critical stage for browser parity. Every sub-step must match exactly.

### 7.1  BGR → Grayscale

```python
gray = cv2.cvtColor(roi_image, cv2.COLOR_BGR2GRAY)   # uint8, shape (H, W)
```

OpenCV's luma formula: `gray = 0.114·B + 0.587·G + 0.299·R`

```js
// JS pseudocode
function bgrToGray(bgr) {
  return bgr.map(([b, g, r]) => Math.round(0.114 * b + 0.587 * g + 0.299 * r));
  // or use cv.cvtColor(src, dst, cv.COLOR_BGR2GRAY) from OpenCV.js
}
```

> If you capture the frame as RGB not BGR, the formula becomes
> `0.299·R + 0.587·G + 0.114·B` (same coefficients, channel order swapped).
> Both produce identical output. Use the formula matching your channel order.

---

### 7.2  Contrast Guard

```python
contrast = int(gray.max()) - int(gray.min())
if contrast < 100:
    return []   # blank slot or background texture — not HUD text
```

| Parameter | Value |
|---|---|
| Threshold | **100** (integer pixel range) |
| Trigger condition | `max(gray) − min(gray) < 100` |
| Return value when triggered | Empty list `[]` |

```js
// JS pseudocode
const grayMax = Math.max(...grayPixels);
const grayMin = Math.min(...grayPixels);
if (grayMax - grayMin < 100) return []; // blank / low-contrast ROI
```

---

### 7.3  Autocrop to Text Core

Crops the image to the tightest bounding box that contains the bright text pixels,
excluding background glow/bleed.

```python
def _autocrop_text(gray):
    peak = int(gray.max())
    if peak < 10:
        return gray                          # essentially blank
    bright_threshold = max(8, round(peak * 0.35))

    col_max = gray.max(axis=0)              # per-column max  shape (W,)
    row_max = gray.max(axis=1)              # per-row max     shape (H,)

    cols = np.where(col_max > bright_threshold)[0]
    rows = np.where(row_max > bright_threshold)[0]

    if len(cols) > 0 and len(rows) > 0:
        x0, x1 = int(cols[0]),  int(cols[-1]) + 1
        y0, y1 = int(rows[0]), int(rows[-1]) + 1
        return gray[y0:y1, x0:x1]
    return gray
```

| Parameter | Value |
|---|---|
| Blank guard threshold | `peak < 10` → return original |
| Brightness threshold | `max(8, round(peak × 0.35))` — 35% of peak pixel value |
| Column scan | `col_max = gray.max(axis=0)` → keep columns with any pixel above threshold |
| Row scan    | `row_max = gray.max(axis=1)` → keep rows with any pixel above threshold |
| Crop bounds | First and last qualifying column/row (inclusive) |

```js
// JS pseudocode
function autocropText(gray, w, h) {
  const peak = Math.max(...gray);
  if (peak < 10) return { data: gray, w, h };
  const brightThreshold = Math.max(8, Math.round(peak * 0.35));

  const colMax = new Float32Array(w);
  const rowMax = new Float32Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      if (v > colMax[x]) colMax[x] = v;
      if (v > rowMax[y]) rowMax[y] = v;
    }

  const validCols = [...Array(w).keys()].filter(x => colMax[x] > brightThreshold);
  const validRows = [...Array(h).keys()].filter(y => rowMax[y] > brightThreshold);
  if (validCols.length === 0 || validRows.length === 0) return { data: gray, w, h };

  const x0 = validCols[0],  x1 = validCols.at(-1) + 1;
  const y0 = validRows[0], y1 = validRows.at(-1) + 1;
  const cw = x1 - x0, ch = y1 - y0;
  const cropped = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++)
    cropped.set(gray.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw);
  return { data: cropped, w: cw, h: ch };
}
```

---

### 7.4  Resize and Pad to 32×256 Canvas

Aspect-preserving scale so the text fits inside 32×256, placed **left-aligned, vertically
centered**, on a **black** background.

```python
TARGET_H, TARGET_W = 32, 256

def resize_pad(gray, target_w=256, target_h=32):
    h, w = gray.shape
    scale  = min(target_h / max(h, 1), target_w / max(w, 1))   # uniform scale
    new_h  = max(1, round(h * scale))
    new_w  = max(1, round(w * scale))
    resized = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_AREA)

    canvas = np.zeros((target_h, target_w), dtype=np.uint8)     # all-black

    y_off = (target_h - new_h) // 2    # vertical center
    # horizontal: left-aligned → x_off = 0
    canvas[y_off : y_off + new_h, 0 : new_w] = resized
    return canvas                       # uint8, shape (32, 256)
```

| Parameter | Value |
|---|---|
| Target height | **32 px** (fixed) |
| Target width | **256 px** (max) |
| Scale formula | `scale = min(32 / h, 256 / w)` |
| Interpolation | **`cv2.INTER_AREA`** (equivalent: area averaging / box filter when downscaling) |
| Canvas fill | **0 (black)** |
| Horizontal placement | **Left-aligned** — text starts at x = 0 |
| Vertical placement | **Centered** — `y_off = (32 − new_h) // 2` (integer division) |

> **Short words** (e.g. "tin" ~10 px wide after autocrop) end up placed at x=0 with
> lots of black padding on the right. **Long words** (e.g. "inert_materials") scale down
> to nearly the full 256 width.

```js
// JS pseudocode
function resizePad(gray, srcW, srcH, targetW = 256, targetH = 32) {
  const scale = Math.min(targetH / Math.max(srcH, 1), targetW / Math.max(srcW, 1));
  const newH  = Math.max(1, Math.round(srcH * scale));
  const newW  = Math.max(1, Math.round(srcW * scale));

  // Resize using INTER_AREA (area averaging). In browser:
  //   Option A — OffscreenCanvas drawImage (browser applies its own interpolation)
  //   Option B — manual box filter for exact parity
  const resized = resizeINTER_AREA(gray, srcW, srcH, newW, newH);

  const canvas = new Uint8Array(targetH * targetW); // zeros = black
  const yOff   = Math.floor((targetH - newH) / 2);  // integer division
  // xOff = 0 (left-aligned)
  for (let y = 0; y < newH; y++)
    canvas.set(resized.subarray(y * newW, y * newW + newW),
               (yOff + y) * targetW);
  return canvas; // uint8, 32×256
}
```

> **Warning about browser canvas interpolation:** `drawImage` uses the browser's
> built-in filter which may be INTER_LINEAR instead of INTER_AREA. For small source
> images this difference is subtle but for downscaling from larger crops it can affect
> predictions. Use a manual area-average or use `imageSmoothingQuality = "high"` +
> `imageSmoothingEnabled = true`.

---

### 7.5  Normalize and Build Tensor

```python
tensor = torch.from_numpy(canvas).float() / 255.0   # values in [0.0, 1.0]
tensor = tensor.unsqueeze(0).unsqueeze(0)            # (32,256) → (1,1,32,256)
```

| Property | Value |
|---|---|
| Dtype | `float32` |
| Value range | `[0.0, 1.0]` |
| Scale factor | `÷ 255.0` |
| Tensor shape | `(1, 1, 32, 256)` — `[batch, channels, height, width]` |
| Mean subtraction | **None** |
| Std normalization | **None** |

> There is **no ImageNet mean/std normalization**. Division by 255 is the only
> normalization step.

```js
// JS pseudocode
const float32 = new Float32Array(32 * 256);
for (let i = 0; i < canvas.length; i++) float32[i] = canvas[i] / 255.0;
// ONNX Runtime JS expects a flat Float32Array with shape [1, 1, 32, 256]
const inputTensor = new ort.Tensor("float32", float32, [1, 1, 32, 256]);
```

---

## 8. Stage 7 — Model Architecture

### Input / Output

| | Shape | Dtype |
|---|---|---|
| Input | `(batch, 1, 32, 256)` | float32 |
| Output (logits) | `(batch, 27)` | float32 |

### Layer-by-Layer

| Layer | Type | Config | Output shape |
|---|---|---|---|
| `conv1` | Conv2d | in=1, out=32, k=3×3, pad=1 | (B, 32, 32, 256) |
| relu | ReLU | — | (B, 32, 32, 256) |
| `pool1` | MaxPool2d | k=2×2, stride=2 | **(B, 32, 16, 128)** |
| `conv2` | Conv2d | in=32, out=64, k=3×3, pad=1 | (B, 64, 16, 128) |
| relu | ReLU | — | (B, 64, 16, 128) |
| `pool2` | MaxPool2d | k=2×2, stride=2 | **(B, 64, 8, 64)** |
| `conv3` | Conv2d | in=64, out=128, k=3×3, pad=1 | (B, 128, 8, 64) |
| relu | ReLU | — | (B, 128, 8, 64) |
| `pool3` | MaxPool2d | k=2×2, stride=2 | **(B, 128, 4, 32)** |
| flatten | Flatten | 128 × 4 × 32 | **(B, 16384)** |
| `fc1` | Linear | in=16384, out=256 | (B, 256) |
| relu | ReLU | — | (B, 256) |
| dropout | Dropout | p=0.3 | (B, 256) |
| `fc2` | Linear | in=256, out=27 | **(B, 27)** |

> **Dropout is active only during training.** At inference time (`model.eval()`) dropout
> is a no-op. ONNX export captures the eval-mode graph, so the ONNX model has no
> dropout nodes.

Total parameters: ~4.3 M

---

## 9. Stage 8 — Post-processing

```python
with torch.no_grad():
    logits = model(tensor)                      # (1, 27) raw logits
    probs  = torch.softmax(logits, dim=1)[0]    # (27,) probabilities, sum = 1.0

scores = [(word_classes[i], float(probs[i])) for i in range(27)]
scores.sort(key=lambda x: x[1], reverse=True)  # descending confidence
return scores
```

```js
// JS pseudocode
const session = await ort.InferenceSession.create("word_cnn.onnx");
const results = await session.run({ input: inputTensor });
const logits  = results["logits"].data;          // Float32Array, length 27

// Softmax
const maxLogit = Math.max(...logits);
const exps = logits.map(v => Math.exp(v - maxLogit));  // numerically stable
const sumExp = exps.reduce((a, b) => a + b, 0);
const probs = exps.map(v => v / sumExp);

// Sort
const scores = wordClasses.map((label, i) => [label, probs[i]]);
scores.sort((a, b) => b[1] - a[1]);
// scores[0] = [topLabel, topConfidence]
```

- Top prediction: `scores[0]`
- All 27 scores are returned; the caller picks the top-1 or top-N.
- An **empty array** (`[]`, from the contrast guard) means the ROI was blank/noisy —
  display as `"?"` with confidence `0.0`.

---

## 10. Class Index Table

The ONNX output logit at index `i` corresponds to the word class below.
These are loaded at runtime from `word_cnn.json` → `wordClasses` array; do not
hardcode unless you pin to a specific model version.

| Index | Class | Index | Class |
|---|---|---|---|
| 0 | `agricium` | 14 | `inert_materials` |
| 1 | `aphorite` | 15 | `iron` |
| 2 | `aslarite` | 16 | `laranite` |
| 3 | `beryl` | 17 | `lindinium` |
| 4 | `bexalite` | 18 | `quartz` |
| 5 | `borase` | 19 | `riccite` |
| 6 | `copper` | 20 | `silicon` |
| 7 | `dolivine` | 21 | `stileron` |
| 8 | `empty` | 22 | `taranite` |
| 9 | `feynmaline` | 23 | `tin` |
| 10 | `gold` | 24 | `titanium` |
| 11 | `hadanite` | 25 | `torite` |
| 12 | `hephaestanite` | 26 | `tungsten` |
| 13 | `ice` | — | — |

> **Index 8 (`empty`)** represents a blank ROI or a slot with no resource. The contrast
> guard (Stage 6.2) typically short-circuits before the model is run for truly blank slots,
> but for low-contrast HUD text the model itself may output `empty` as the top class.

---

## 11. ONNX Export Specification

Produced by `cnn_word_export_onnx.py`:

```python
torch.onnx.export(
    model,
    torch.randn(1, 1, 32, 256),   # dummy input (float32)
    output_path,
    input_names=["input"],
    output_names=["logits"],
    dynamic_axes={
        "input":  {0: "batch"},
        "logits": {0: "batch"},
    },
    opset_version=17,
)
```

| Property | Value |
|---|---|
| ONNX opset | **17** |
| Input node name | `"input"` |
| Output node name | `"logits"` |
| Dynamic axis | `batch` dimension only (dim 0) |
| Fixed axes | `channels=1`, `height=32`, `width=256` |
| Dummy input dtype | `float32` |
| Output dtype | `float32` (raw logits, **not** softmax-ed) |

### Sidecar metadata JSON (`word_cnn.json`)

```json
{
  "numClasses": 27,
  "inputShape": [1, 1, 32, 256],
  "wordClasses": ["agricium", "aphorite", ..., "tungsten"],
  "valAccuracy": 0.9988951632703167
}
```

Load `word_cnn.json` at startup to obtain the authoritative `wordClasses` list and
to verify `inputShape` before constructing the input tensor.

---

## 12. Common Browser Pitfalls

The following mismatches cause subtle or severe accuracy regressions. Each has been
observed or is a likely error surface in browser re-implementations.

---

### P1 — Wrong horizontal placement (right-align instead of left-align)

**Python:** text placed at `x = 0` (left edge of canvas), black padding fills the right.  
**Wrong browser:** centering the text horizontally or placing it on the right.  
**Impact:** catastrophic — the model learned that short-word blanks are on the right;
if you put padding on the left, every short word is mis-classified.

---

### P2 — Skipping the autocrop step

**Python:** autocrop removes surrounding glow/bleed before resize.  
**Wrong browser:** resize the full raw ROI directly.  
**Impact:** significant — the effective text-to-canvas ratio changes, altering the CNN's
spatial feature distribution. Long-padding short words become even smaller.

---

### P3 — Skipping the contrast guard

**Python:** returns `[]` (no prediction) when `max − min < 100`.  
**Wrong browser:** runs the model on blank/noisy ROIs.  
**Impact:** model will output some class (often `empty`) but confidence is meaningless,
and the pipeline should be outputting `"?"` + `0.0` instead.

---

### P4 — Applying ImageNet normalization

**Python:** only `÷ 255.0` — no mean/std shift.  
**Wrong browser:** subtracting `[0.485, 0.456, 0.406]` mean or dividing by std.  
**Impact:** entire activation distribution is shifted; model gives random outputs.

---

### P5 — Applying softmax twice

**Python:** ONNX output is raw logits; `softmax` is applied in post-processing JS.  
**Wrong browser:** model already applies softmax internally (it doesn't), or
applying softmax to what is already softmax output.  
**Impact:** probabilities become near-uniform; top confidence is artificially low.

---

### P6 — Wrong interpolation method

**Python:** `cv2.INTER_AREA` for downscaling (area averaging).  
**Wrong browser:** `INTER_LINEAR` (bilinear) or `INTER_NEAREST` via canvas `drawImage`.  
**Impact:** subtle — more visible for large-to-small downscales. Use a manual box filter
or `imageSmoothingEnabled = true` with `imageSmoothingQuality = "high"` as an
approximation.

---

### P7 — Wrong autocrop threshold formula

**Correct:** `bright_threshold = max(8, round(peak * 0.35))`  
**Wrong:** using a fixed threshold (e.g. 128) or `peak * 0.5`.  
**Impact:** over-crops dark text (loses character strokes) or under-crops bright backgrounds.

---

### P8 — Using `Math.floor` instead of `Math.round` for new dimensions

**Python:** `new_h = max(1, round(h * scale))` uses **round**, not floor.  
**Wrong browser:** `Math.floor(h * scale)`.  
**Impact:** off-by-one in canvas dimensions; vertical centering offset changes; subtle
but reproducible mismatch.

---

### P9 — Channel order confusion feeding color frames

**Python:** frame is BGR; predictor converts `COLOR_BGR2GRAY`.  
**Browser:** if you provide an RGB frame, use `COLOR_RGB2GRAY` (or the equivalent
luma formula `0.299·R + 0.587·G + 0.114·B`).  
**Impact:** for pure grayscale/equal-channel content the result is identical. Only
matters for color ROIs before they reach the predictor (e.g. if you skip the grayscale
filter in Stage 4).

---

### P10 — Vertex order of `y_off` integer division

**Python:** `y_off = (32 - new_h) // 2` — Python integer division truncates toward
negative infinity (same as `Math.floor` for positive numbers).  
**Browser:** `Math.floor((32 - newH) / 2)` is the correct equivalent.  
**Impact:** one-pixel vertical shift for odd `new_h` values changes the spatial
position of text features in the 32-row feature map.
