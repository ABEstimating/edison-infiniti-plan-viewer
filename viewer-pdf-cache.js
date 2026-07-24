(() => {
  'use strict';

  if (!window.pdfjsLib) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const DEFAULT_SOURCE_ID = '__sourcePdf';
  const sourceBlobPromises = new Map();
  const pdfDocumentPromises = new Map();
  let renderSerial = 0;
  let renderTimer = 0;
  let cacheStarted = false;

  const pdfCanvas = document.createElement('canvas');
  pdfCanvas.id = 'pdfCanvas';
  pdfCanvas.className = 'pdfCanvas';
  pdfCanvas.setAttribute('aria-hidden', 'true');
  plan.insertAdjacentElement('afterend', pdfCanvas);
  const pdfContext = pdfCanvas.getContext('2d', { alpha: false, desynchronized: true });

  const cacheBadge = document.createElement('button');
  cacheBadge.id = 'pdfCacheBadge';
  cacheBadge.type = 'button';
  cacheBadge.className = 'pdfCacheBadge';
  cacheBadge.textContent = 'PDF sharp mode pending';
  cacheBadge.title = 'Original PDF rendering and project cache status';
  document.querySelector('.toolbar')?.appendChild(cacheBadge);

  function setCacheBadge(text, state = '') {
    cacheBadge.textContent = text;
    cacheBadge.dataset.state = state;
  }

  function projectVersion() {
    return String(manifest?.packageVersion || manifest?.setDate || '1');
  }

  function sourceEntries() {
    const cfg = manifest?.pdfSources;
    if (cfg) {
      if (Array.isArray(cfg)) return cfg.map((value, index) => [String(value.id ?? index), value]);
      return Object.entries(cfg);
    }
    if (manifest?.sourcePdf) {
      return [[DEFAULT_SOURCE_ID, {
        path: manifest.sourcePdf,
        name: manifest.projectName ? `${manifest.projectName} linked searchable plans` : 'Linked searchable plans',
        size: Number(manifest.sourcePdfSize) || 0
      }]];
    }
    return [];
  }

  function sourceConfig(id) {
    return sourceEntries().find(([key]) => key === String(id))?.[1] || null;
  }

  function sourcePath(id) {
    const cfg = sourceConfig(id);
    return cfg?.path || cfg?.url || cfg?.file || '';
  }

  function sheetPdfInfo(index) {
    const sheet = sheets[index] || {};
    let source = sheet.pdfSource ?? sheet.pdf ?? sheet.sourcePdfId;
    if ((source === undefined || source === null || source === '') && manifest?.sourcePdf) source = DEFAULT_SOURCE_ID;
    const pageNumber = Number(sheet.pdfPage ?? sheet.sourcePage ?? sheet.page ?? index + 1);
    if (source === undefined || source === null || !Number.isFinite(pageNumber) || pageNumber < 1) return null;
    return { source: String(source), pageNumber };
  }

  function dbName() {
    return 'ab-plan-pdf-cache-v1';
  }

  function cacheKey(sourceId) {
    return `${projectId}:${projectVersion()}:${sourceId}`;
  }

  function openPdfDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName(), 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readCachedBlob(sourceId) {
    try {
      const db = await openPdfDb();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readonly');
        const request = tx.objectStore('pdfs').get(cacheKey(sourceId));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value instanceof Blob ? value : null;
    } catch (error) {
      console.warn('PDF cache read failed', error);
      return null;
    }
  }

  async function writeCachedBlob(sourceId, blob) {
    try {
      const db = await openPdfDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put(blob, cacheKey(sourceId));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (error) {
      console.warn('PDF cache write failed', error);
    }
  }

  async function downloadBlob(sourceId, ordinal, total) {
    const path = sourcePath(sourceId);
    if (!path) throw new Error(`No PDF path configured for ${sourceId}`);

    const response = await fetch(`${resolveAsset(path)}?v=${encodeURIComponent(projectVersion())}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`PDF source unavailable (${response.status}): ${path}`);

    const expected = Number(response.headers.get('content-length')) || Number(sourceConfig(sourceId)?.size) || 0;
    if (!response.body || !expected) {
      setCacheBadge(total > 1 ? `Caching PDFs ${ordinal}/${total}` : 'Loading sharp PDF');
      return response.blob();
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const percent = Math.min(100, Math.round((received / expected) * 100));
      setCacheBadge(total > 1 ? `Caching ${ordinal}/${total} · ${percent}%` : `Loading PDF · ${percent}%`);
    }
    return new Blob(chunks, { type: 'application/pdf' });
  }

  async function getSourceBlob(sourceId, ordinal = 1, total = 1) {
    if (sourceBlobPromises.has(sourceId)) return sourceBlobPromises.get(sourceId);

    const promise = (async () => {
      const cached = await readCachedBlob(sourceId);
      if (cached) return cached;
      const blob = await downloadBlob(sourceId, ordinal, total);
      await writeCachedBlob(sourceId, blob);
      return blob;
    })();

    sourceBlobPromises.set(sourceId, promise);
    try {
      return await promise;
    } catch (error) {
      sourceBlobPromises.delete(sourceId);
      throw error;
    }
  }

  async function getPdfDocument(sourceId) {
    if (pdfDocumentPromises.has(sourceId)) return pdfDocumentPromises.get(sourceId);
    const promise = (async () => {
      const blob = await getSourceBlob(sourceId);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return pdfjsLib.getDocument({ data: bytes, disableAutoFetch: false, disableStream: false }).promise;
    })();
    pdfDocumentPromises.set(sourceId, promise);
    try {
      return await promise;
    } catch (error) {
      pdfDocumentPromises.delete(sourceId);
      throw error;
    }
  }

  async function cacheWholeProject() {
    if (cacheStarted || !manifest?.cacheProjectOnLoad) return;
    const entries = sourceEntries();
    if (!entries.length) return;
    cacheStarted = true;

    try {
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      for (let index = 0; index < entries.length; index++) {
        const [sourceId] = entries[index];
        await getSourceBlob(sourceId, index + 1, entries.length);
      }
      setCacheBadge('PDF project cached', 'ready');
      toast('Original PDF project cached for fast repeat visits.');
    } catch (error) {
      console.warn('Whole-project PDF cache did not finish', error);
      setCacheBadge('PDF unavailable', 'error');
    }
  }

  function syncPdfCanvas() {
    pdfCanvas.style.width = plan.style.width;
    pdfCanvas.style.height = plan.style.height;
    pdfCanvas.style.transform = plan.style.transform;
  }

  const originalTransformImage = transformImage;
  transformImage = function enhancedTransformImage() {
    originalTransformImage();
    syncPdfCanvas();
  };

  async function renderPdfSheet(index, force = false) {
    const info = sheetPdfInfo(index);
    if (!info || !sourcePath(info.source)) return false;

    const serial = ++renderSerial;

    try {
      const documentProxy = await getPdfDocument(info.source);
      const pageProxy = await documentProxy.getPage(info.pageNumber);
      const baseViewport = pageProxy.getViewport({ scale: 1 });

      const previewFailed = $('error').style.display === 'grid' || !(plan.complete && plan.naturalWidth);
      if (previewFailed) {
        naturalW = 1600;
        naturalH = Math.max(1, Math.round(1600 * baseViewport.height / baseViewport.width));
        originalFit(mode === 'custom' ? 'page' : mode);
      }

      const displayedWidth = Math.max(1, naturalW * scale);
      const displayedHeight = Math.max(1, naturalH * scale);
      const deviceRatio = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
      const requestedWidth = Math.max(1200, displayedWidth * deviceRatio * 1.2);
      const requestedHeight = Math.max(900, displayedHeight * deviceRatio * 1.2);

      if (!force && pdfCanvas.dataset.page === String(index + 1)) {
        const renderedWidth = Number(pdfCanvas.dataset.renderedWidth) || 0;
        const renderedHeight = Number(pdfCanvas.dataset.renderedHeight) || 0;
        if (renderedWidth >= requestedWidth * 0.9 && renderedHeight >= requestedHeight * 0.9) return true;
      }
      const maxDimension = 10000;
      const maxPixels = 48000000;
      let renderScale = Math.max(requestedWidth / baseViewport.width, requestedHeight / baseViewport.height);
      renderScale = Math.min(renderScale, maxDimension / Math.max(baseViewport.width, baseViewport.height));
      const estimatedPixels = baseViewport.width * baseViewport.height * renderScale * renderScale;
      if (estimatedPixels > maxPixels) renderScale *= Math.sqrt(maxPixels / estimatedPixels);
      renderScale = Math.max(0.5, renderScale);

      const viewport = pageProxy.getViewport({ scale: renderScale });
      const renderWidth = Math.max(1, Math.round(viewport.width));
      const renderHeight = Math.max(1, Math.round(viewport.height));
      const scratch = document.createElement('canvas');
      scratch.width = renderWidth;
      scratch.height = renderHeight;
      const scratchContext = scratch.getContext('2d', { alpha: false, desynchronized: true });
      await pageProxy.render({ canvasContext: scratchContext, viewport, background: '#ffffff' }).promise;

      if (serial !== renderSerial || index !== page - 1) return false;
      pdfCanvas.width = renderWidth;
      pdfCanvas.height = renderHeight;
      pdfContext.clearRect(0, 0, renderWidth, renderHeight);
      pdfContext.drawImage(scratch, 0, 0);
      pdfCanvas.dataset.page = String(index + 1);
      pdfCanvas.dataset.renderedWidth = String(requestedWidth);
      pdfCanvas.dataset.renderedHeight = String(requestedHeight);
      syncPdfCanvas();
      pdfCanvas.classList.add('ready');
      plan.classList.add('previewUnderPdf');
      setCacheBadge('Sharp PDF active', 'ready');
      ready();
      return true;
    } catch (error) {
      console.warn(`Sharp PDF render unavailable for sheet ${index + 1}`, error);
      setCacheBadge('PDF render failed', 'error');
      return false;
    }
  }

  function schedulePdfRender(force = false, delay = 120) {
    clearTimeout(renderTimer);
    const target = page - 1;
    renderTimer = setTimeout(() => renderPdfSheet(target, force), delay);
  }

  const originalShowPage = showPage;
  showPage = async function enhancedShowPage() {
    ++renderSerial;
    pdfCanvas.classList.remove('ready');
    plan.classList.remove('previewUnderPdf');
    pdfCanvas.dataset.page = '';
    const result = await originalShowPage();
    schedulePdfRender(true, 0);
    return result;
  };

  const originalZoomAt = zoomAt;
  zoomAt = function enhancedPdfZoomAt(mult, clientX, clientY) {
    const result = originalZoomAt(mult, clientX, clientY);
    schedulePdfRender(false, 130);
    return result;
  };

  const originalFit = fit;
  fit = function enhancedPdfFit(which = mode) {
    const result = originalFit(which);
    schedulePdfRender(false, 80);
    return result;
  };

  cacheBadge.onclick = () => {
    cacheStarted = false;
    sourceBlobPromises.clear();
    pdfDocumentPromises.clear();
    if (manifest?.cacheProjectOnLoad) cacheWholeProject();
    schedulePdfRender(true, 0);
  };

  const manifestWatcher = setInterval(() => {
    if (!manifest || !Array.isArray(sheets) || !sheets.length) return;
    clearInterval(manifestWatcher);
    if (!sourceEntries().length) {
      setCacheBadge('PNG preview only', 'error');
      return;
    }
    if (manifest.cacheProjectOnLoad) {
      setCacheBadge('Caching original PDFs');
      cacheWholeProject();
    } else {
      setCacheBadge('PDF sharp mode');
    }
    schedulePdfRender(true, 0);
  }, 50);
})();
