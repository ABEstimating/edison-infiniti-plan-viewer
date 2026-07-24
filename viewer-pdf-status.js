(() => {
  'use strict';

  const viewerElement = document.getElementById('viewer');
  if (!viewerElement) return;

  const status = document.createElement('div');
  status.id = 'pdfLoadStatus';
  status.className = 'pdfLoadStatus';
  status.hidden = true;
  status.innerHTML = `
    <div class="pdfStatusRow">
      <span class="pdfStatusSpinner" aria-hidden="true"></span>
      <span class="pdfStatusText">PDF Loading</span>
    </div>
    <div class="pdfStatusTrack"><span class="pdfStatusBar"></span></div>
  `;
  viewerElement.appendChild(status);

  const text = status.querySelector('.pdfStatusText');
  const bar = status.querySelector('.pdfStatusBar');
  let hideTimer = 0;
  let configured = false;

  function clearHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function showLoading(label = 'PDF Loading', progress = null) {
    clearHideTimer();
    status.hidden = false;
    status.dataset.state = 'loading';
    text.textContent = label;
    if (Number.isFinite(progress)) {
      status.classList.remove('indeterminate');
      bar.style.width = `${Math.max(2, Math.min(100, progress))}%`;
    } else {
      status.classList.add('indeterminate');
      bar.style.width = '38%';
    }
  }

  function showReady() {
    clearHideTimer();
    status.hidden = false;
    status.dataset.state = 'ready';
    status.classList.remove('indeterminate');
    text.textContent = 'Sharp PDF Ready';
    bar.style.width = '100%';
    hideTimer = setTimeout(() => { status.hidden = true; }, 1400);
  }

  function showError() {
    clearHideTimer();
    status.hidden = false;
    status.dataset.state = 'error';
    status.classList.remove('indeterminate');
    text.textContent = 'PDF Unavailable';
    bar.style.width = '100%';
  }

  function hasPdfSource() {
    if (typeof manifest === 'undefined' || !manifest) return false;
    if (manifest.sourcePdf) return true;
    const sources = manifest.pdfSources;
    return Array.isArray(sources) ? sources.length > 0 : Boolean(sources && Object.keys(sources).length);
  }

  function sync() {
    if (!hasPdfSource()) {
      if (configured) status.hidden = true;
      return;
    }
    configured = true;

    const badge = document.getElementById('pdfCacheBadge');
    const canvas = document.getElementById('pdfCanvas');
    const badgeText = String(badge?.textContent || '').trim();
    const lower = badgeText.toLowerCase();
    const state = badge?.dataset.state || '';
    const percentMatch = badgeText.match(/(\d{1,3})%/);
    const percent = percentMatch ? Number(percentMatch[1]) : null;

    if (state === 'error' || lower.includes('failed') || lower.includes('unavailable')) {
      showError();
      return;
    }

    if (canvas?.classList.contains('ready')) {
      showReady();
      return;
    }

    if (percent !== null) {
      showLoading(`PDF Loading · ${percent}%`, percent);
      return;
    }

    if (lower.includes('caching') || lower.includes('loading') || lower.includes('pending') || lower.includes('pdf sharp mode') || lower.includes('sharp pdf active') || !badgeText) {
      showLoading('PDF Loading');
      return;
    }

    showLoading('PDF Loading');
  }

  status.addEventListener('click', () => document.getElementById('pdfCacheBadge')?.click());

  const observer = new MutationObserver(sync);
  const attach = () => {
    const badge = document.getElementById('pdfCacheBadge');
    const canvas = document.getElementById('pdfCanvas');
    if (badge) observer.observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });
    if (canvas) observer.observe(canvas, { attributes: true, attributeFilter: ['class', 'data-page'] });
    sync();
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (document.getElementById('pdfCacheBadge') && document.getElementById('pdfCanvas') && typeof manifest !== 'undefined' && manifest) {
      clearInterval(timer);
      attach();
    } else if (attempts > 200) {
      clearInterval(timer);
      status.hidden = true;
    }
  }, 50);
})();
