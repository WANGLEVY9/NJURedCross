/** Geometric red-region hints only; this does not authenticate a seal or prove its absence. */
export function redSealCandidates({ data, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width * height > 5_000_000 || data.length !== width * height * 4) throw new Error('图像尺寸不正确');
  // Downsample for bounded connected-component work. Regions map back to normalized page coordinates.
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 1000));
  const w = Math.ceil(width / step), h = Math.ceil(height / step);
  const redMask = new Uint8Array(w * h), brightMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const index = (Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)) * 4;
    const r = data[index], g = data[index + 1], b = data[index + 2];
    const red = r > 110 && r - g > 35 && r - b > 30 && g < r * .82 && b < r * .85;
    redMask[y * w + x] = red ? 1 : 0;
    brightMask[y * w + x] = red && r > 170 ? 1 : 0;
  }
  const regions = [];
  for (const source of [brightMask, redMask]) {
    // Invoice grids and title rules can connect an otherwise separate stamp to the whole page.
    const clean = source.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w;) {
        if (!source[y * w + x]) { x++; continue; }
        const start = x; while (x < w && source[y * w + x]) x++;
        if (x - start > w * .25) clean.fill(0, y * w + start, y * w + x);
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h;) {
        if (!source[y * w + x]) { y++; continue; }
        const start = y; while (y < h && source[y * w + x]) y++;
        if (y - start > h * .35) for (let row = start; row < y; row++) clean[row * w + x] = 0;
      }
    }
    // Bridge small breaks in stamped outlines; score the original ink, not the expanded area.
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!clean[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) mask[ny * w + nx] = 1;
      }
    }
    for (const region of connectedEllipses(mask, clean, w, h)) {
      if (!regions.some(previous => Math.abs(previous.x - region.x) < .025 && Math.abs(previous.y - region.y) < .025)) regions.push(region);
      if (regions.length === 5) break;
    }
    if (regions.length === 5) break;
  }
  return { state: regions.length ? 'candidate' : 'not-detected', regions,
    message: regions.length ? '检测到疑似红章，请核对原票。'
      : '未检测到红章；褪色、遮挡或黑白扫描可能漏检，不能据此认定无章。' };
}

function connectedEllipses(mask, ink, w, h) {
  const queue = new Int32Array(w * h), regions = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed]) continue;
    let head = 0, tail = 1, minX = w, minY = h, maxX = 0, maxY = 0;
    queue[0] = seed; mask[seed] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % w, y = Math.floor(index / w);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        if (mask[next]) { mask[next] = 0; queue[tail++] = next; }
      }
    }
    const rw = maxX - minX + 1, rh = maxY - minY + 1, ratio = rw / rh;
    const count = queue.subarray(0, tail).reduce((total, index) => total + ink[index], 0), fill = count / (rw * rh);
    if (rw < 20 || rh < 20 || rw > w * .5 || rh > h * .5 || ratio < .5 || ratio > 2.3 || fill < .015 || fill > .5) continue;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const sectors = new Set(); let nearRing = 0;
    for (let index = 0; index < tail; index++) {
      const pixel = queue[index], x = ((pixel % w) - cx) / (rw / 2), y = (Math.floor(pixel / w) - cy) / (rh / 2);
      if (!ink[pixel]) continue;
      const radius = Math.hypot(x, y);
      if (radius > .77 && radius < 1.15) { nearRing++; sectors.add(Math.floor((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * 12) % 12); }
    }
    if (nearRing / count < .35 || sectors.size < 9) continue;
    regions.push({ x: minX / w, y: minY / h, width: rw / w, height: rh / h, kind: 'red-ellipse-region' });
    if (regions.length === 5) break;
  }
  return regions;
}
