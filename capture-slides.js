/**
 * DeepLearning.ai Slide Capture Script
 * Paste this entire script into the browser DevTools console while on the lesson page.
 * It will scan the video, detect slide changes, and export a PDF.
 */
(async function captureSlides() {

  /* ── 1. Load dependencies ── */
  async function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load: ' + url));
      document.head.appendChild(s);
    });
  }

  console.log('[SlideCapture] Loading jsPDF and html2canvas…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  console.log('[SlideCapture] Libraries loaded.');

  /* ── 2. Find the video element ── */
  const video = document.querySelector('video');
  if (!video) {
    console.error('[SlideCapture] No <video> element found on this page.');
    return;
  }

  /* ── 3. Derive a clean filename from the page title ── */
  const rawTitle = document.title.trim() || 'lesson';
  const fileName = rawTitle.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
  console.log('[SlideCapture] Lesson:', rawTitle);
  console.log('[SlideCapture] Output file:', fileName);

  /* ── 4. Setup capture canvas (matches video dimensions) ── */
  const W = video.videoWidth  || 1280;
  const H = video.videoHeight || 720;
  const cap = document.createElement('canvas');
  cap.width  = W;
  cap.height = H;
  const ctx = cap.getContext('2d');

  /* ── 5. Frame fingerprint for scene-change detection ── */
  const GRID = 16; // 16×16 = 256 sample points
  function fingerprint() {
    ctx.drawImage(video, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const xStep = Math.floor(W / GRID);
    const yStep = Math.floor(H / GRID);
    const fp = new Uint8Array(GRID * GRID * 3);
    let i = 0;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const px = (gy * yStep * W + gx * xStep) * 4;
        fp[i++] = data[px];     // R
        fp[i++] = data[px + 1]; // G
        fp[i++] = data[px + 2]; // B
      }
    }
    return fp;
  }

  function fpDiff(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length; // average absolute channel diff (0–255)
  }

  /* ── 6. Scan the entire video, collecting unique slide frames ── */
  const SAMPLE_INTERVAL = 0.5;  // seconds between samples
  const CHANGE_THRESHOLD = 8;   // avg channel diff to count as a new slide
  const SETTLE_FRAMES = 3;       // consecutive similar frames before saving

  const duration = video.duration;
  if (!isFinite(duration) || duration === 0) {
    console.error('[SlideCapture] Video duration unknown — make sure the video is loaded.');
    return;
  }
  console.log(`[SlideCapture] Video duration: ${duration.toFixed(1)}s`);
  console.log('[SlideCapture] Scanning for slides… (this may take a while)');

  video.pause();

  const slides = []; // array of { time, dataUrl }
  let prevFp = null;
  let sameSinceCount = 0;
  let pendingTime = null;
  let pendingFp   = null;

  for (let t = 0; t <= duration; t += SAMPLE_INTERVAL) {
    // Seek to time t
    await new Promise(resolve => {
      video.currentTime = t;
      video.addEventListener('seeked', resolve, { once: true });
    });

    const fp = fingerprint();
    const diff = prevFp ? fpDiff(fp, prevFp) : 999;

    if (diff >= CHANGE_THRESHOLD) {
      // Scene changed — reset settle counter
      sameSinceCount = 1;
      pendingTime = t;
      pendingFp   = fp;
    } else {
      sameSinceCount++;
      // After SETTLE_FRAMES stable frames, commit the slide
      if (sameSinceCount === SETTLE_FRAMES && pendingTime !== null) {
        // Seek back to the settled frame for a clean capture
        await new Promise(resolve => {
          video.currentTime = pendingTime;
          video.addEventListener('seeked', resolve, { once: true });
        });
        ctx.drawImage(video, 0, 0, W, H);
        const dataUrl = cap.toDataURL('image/jpeg', 0.92);
        slides.push({ time: pendingTime, dataUrl });
        const pct = ((t / duration) * 100).toFixed(0);
        console.log(`[SlideCapture] Slide ${slides.length} @ ${pendingTime.toFixed(1)}s  (${pct}% scanned)`);
        pendingTime = null;
      }
    }

    prevFp = fp;
  }

  // Capture whatever was pending at the very end
  if (pendingTime !== null) {
    await new Promise(resolve => {
      video.currentTime = pendingTime;
      video.addEventListener('seeked', resolve, { once: true });
    });
    ctx.drawImage(video, 0, 0, W, H);
    slides.push({ time: pendingTime, dataUrl: cap.toDataURL('image/jpeg', 0.92) });
  }

  if (slides.length === 0) {
    console.warn('[SlideCapture] No slide changes detected. Try lowering CHANGE_THRESHOLD.');
    return;
  }
  console.log(`[SlideCapture] Found ${slides.length} slides. Building PDF…`);

  /* ── 7. Build PDF (landscape, one slide per page) ── */
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H] });

  slides.forEach(({ dataUrl }, idx) => {
    if (idx > 0) pdf.addPage([W, H], 'landscape');
    pdf.addImage(dataUrl, 'JPEG', 0, 0, W, H);
  });

  /* ── 8. Download ── */
  pdf.save(fileName);
  console.log(`[SlideCapture] Done! PDF saved as "${fileName}" (${slides.length} pages).`);

})();
