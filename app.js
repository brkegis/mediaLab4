const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const thr = document.getElementById("thr");
const thrVal = document.getElementById("thrVal");
const scaleSel = document.getElementById("scale");

thr.addEventListener("input", () => (thrVal.textContent = thr.value));

const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true });

async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  video.srcObject = stream;

  video.addEventListener("loadedmetadata", () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    requestAnimationFrame(tick);
  });
}

function tick() {
  const scale = Number(scaleSel.value);
  const ww = Math.max(1, Math.floor(video.videoWidth * scale));
  const wh = Math.max(1, Math.floor(video.videoHeight * scale));

  if (work.width !== ww || work.height !== wh) {
    work.width = ww;
    work.height = wh;
  }

  // draw scaled frame into work canvas
  wctx.drawImage(video, 0, 0, ww, wh);
  const frame = wctx.getImageData(0, 0, ww, wh);

  const low = Number(thr.value);
  const high = Math.min(255, low * 2);

  const edges = canny(frame, low, high);

  // upscale back to main canvas
  wctx.putImageData(edges, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(work, 0, 0, canvas.width, canvas.height);

  requestAnimationFrame(tick);
}

start().catch(err => {
  console.error(err);
  alert("Camera error: " + err.message + "\nAtidaryk per HTTPS (HFS) ir leisk kamerą.");
});

function canny(imageData, lowThr, highThr) {
  const { data, width: w, height: h } = imageData;

  // 1) grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 2) Gaussian blur (separable [1,4,6,4,1]/16)
  const tmp = new Float32Array(w * h);
  const blur = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = gray[row + clamp(x - 2, 0, w - 1)];
      const b = gray[row + clamp(x - 1, 0, w - 1)];
      const c = gray[row + x];
      const d = gray[row + clamp(x + 1, 0, w - 1)];
      const e = gray[row + clamp(x + 2, 0, w - 1)];
      tmp[row + x] = (a + 4 * b + 6 * c + 4 * d + e) / 16;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[clamp(y - 2, 0, h - 1) * w + x];
      const b = tmp[clamp(y - 1, 0, h - 1) * w + x];
      const c = tmp[y * w + x];
      const d = tmp[clamp(y + 1, 0, h - 1) * w + x];
      const e = tmp[clamp(y + 2, 0, h - 1) * w + x];
      blur[y * w + x] = (a + 4 * b + 6 * c + 4 * d + e) / 16;
    }
  }

  // 3) Sobel gradients
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;

      const gx =
        -blur[(y - 1) * w + (x - 1)] + blur[(y - 1) * w + (x + 1)] +
        -2 * blur[y * w + (x - 1)]     + 2 * blur[y * w + (x + 1)] +
        -blur[(y + 1) * w + (x - 1)] + blur[(y + 1) * w + (x + 1)];

      const gy =
        -blur[(y - 1) * w + (x - 1)] - 2 * blur[(y - 1) * w + x] - blur[(y - 1) * w + (x + 1)] +
         blur[(y + 1) * w + (x - 1)] + 2 * blur[(y + 1) * w + x] + blur[(y + 1) * w + (x + 1)];

      const m = Math.hypot(gx, gy);
      mag[i] = m;

      let a = Math.atan2(gy, gx) * (180 / Math.PI);
      if (a < 0) a += 180;
      ang[i] = a;
    }
  }

  // 4) Non-maximum suppression
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = ang[i];
      const m = mag[i];

      let m1 = 0, m2 = 0;
      if ((a >= 0 && a < 22.5) || (a >= 157.5 && a < 180)) {
        m1 = mag[i - 1]; m2 = mag[i + 1];
      } else if (a >= 22.5 && a < 67.5) {
        m1 = mag[(y - 1) * w + (x + 1)];
        m2 = mag[(y + 1) * w + (x - 1)];
      } else if (a >= 67.5 && a < 112.5) {
        m1 = mag[(y - 1) * w + x];
        m2 = mag[(y + 1) * w + x];
      } else {
        m1 = mag[(y - 1) * w + (x - 1)];
        m2 = mag[(y + 1) * w + (x + 1)];
      }

      nms[i] = (m >= m1 && m >= m2) ? m : 0;
    }
  }

  // 5) Double threshold + hysteresis
  const strong = 255, weak = 40;
  const out = new Uint8ClampedArray(w * h);

  for (let i = 0; i < w * h; i++) {
    const v = nms[i];
    if (v >= highThr) out[i] = strong;
    else if (v >= lowThr) out[i] = weak;
    else out[i] = 0;
  }

  const stack = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (out[i] === strong) stack.push(i);
    }
  }

  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const j = (y + dy) * w + (x + dx);
        if (out[j] === weak) {
          out[j] = strong;
          stack.push(j);
        }
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (out[i] !== strong) out[i] = 0;
  }

  const res = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = out[i];
    res.data[i * 4 + 0] = v;
    res.data[i * 4 + 1] = v;
    res.data[i * 4 + 2] = v;
    res.data[i * 4 + 3] = 255;
  }
  return res;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}