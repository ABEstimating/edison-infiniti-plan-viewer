(() => {
  const style = document.createElement('style');
  style.textContent = `
    .sheetLinks{position:absolute;left:0;top:0;display:block;max-width:none;transform-origin:0 0;z-index:6;pointer-events:none}
    .sheetLink{position:absolute;display:block;pointer-events:auto;cursor:pointer;border:1px solid rgba(37,99,235,.28);border-radius:3px;background:rgba(37,99,235,.055);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);outline:none}
    .sheetLink:hover,.sheetLink:focus-visible{border-color:rgba(37,99,235,.95);background:rgba(37,99,235,.2);box-shadow:0 0 0 2px rgba(37,99,235,.24)}
    @media(max-width:760px){.sheetLink{border-color:rgba(37,99,235,.38);background:rgba(37,99,235,.085)}}
  `;
  document.head.appendChild(style);

  const linkCache = new Map();
  const explicitPages = new Map();
  let explicitIndexPromise = null;
  let explicitIndexPath = '';
  let aliasSignature = '';
  let aliasMap = new Map();

  function normalizeDash(value) {
    return String(value ?? '').replace(/[‐‑‒–—―]/g, '-');
  }

  function refKey(value) {
    return normalizeDash(value)
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9.]/g, '')
      .replace(/\.{2,}/g, '.');
  }

  function compactKey(value) {
    return refKey(value).replace(/[^A-Z0-9]/g, '');
  }

  function unpaddedKey(value) {
    const key = refKey(value);
    const match = key.match(/^([A-Z]{1,4})(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!match) return key;
    const parts = [match[1], String(Number(match[2]))];
    if (match[3] !== undefined) parts.push(String(Number(match[3])));
    if (match[4] !== undefined) parts.push(String(Number(match[4])));
    return parts[0] + parts.slice(1).join('.');
  }

  function rebuildAliasMap() {
    if (!Array.isArray(sheets) || !sheets.length) return;
    const signature = sheets.map(sheet => sheetNumber(sheet)).join('|');
    if (signature === aliasSignature) return;
    aliasSignature = signature;
    linkCache.clear();

    const candidates = new Map();
    sheets.forEach((sheet, index) => {
      const number = String(sheetNumber(sheet) || '').trim();
      if (!/[A-Za-z]/.test(number)) return;
      const aliases = new Set([
        refKey(number),
        compactKey(number),
        unpaddedKey(number),
        compactKey(unpaddedKey(number))
      ]);
      for (const alias of aliases) {
        if (!alias || alias.length < 3) continue;
        if (!candidates.has(alias)) candidates.set(alias, new Set());
        candidates.get(alias).add(index + 1);
      }
    });

    aliasMap = new Map();
    for (const [alias, pages] of candidates) {
      if (pages.size === 1) aliasMap.set(alias, [...pages][0]);
    }
  }

  function resolveReference(raw) {
    if (!raw) return 0;
    rebuildAliasMap();
    const text = normalizeDash(raw).toUpperCase();
    const matches = text.match(/[A-Z]{1,4}\s*-?\s*\d+(?:\s*\.\s*\d+){0,2}/g) || [];
    for (const match of matches) {
      const aliases = [refKey(match), compactKey(match), unpaddedKey(match), compactKey(unpaddedKey(match))];
      for (const alias of aliases) {
        const target = aliasMap.get(alias);
        if (target) return target;
      }
    }
    return 0;
  }

  function centerY(word) {
    return Number(word.y) + Number(word.h) / 2;
  }

  function canJoin(a, b) {
    if (!a || !b) return false;
    const ah = Math.max(0.001, Number(a.h) || 0);
    const bh = Math.max(0.001, Number(b.h) || 0);
    const vertical = Math.abs(centerY(a) - centerY(b));
    const gap = Number(b.x) - (Number(a.x) + Number(a.w));
    return vertical <= Math.max(ah, bh) * 0.9 && gap >= -0.008 && gap <= Math.max(0.025, Math.max(ah, bh) * 2.8);
  }

  function combinedBox(words) {
    const left = Math.min(...words.map(word => Number(word.x)));
    const top = Math.min(...words.map(word => Number(word.y)));
    const right = Math.max(...words.map(word => Number(word.x) + Number(word.w)));
    const bottom = Math.max(...words.map(word => Number(word.y) + Number(word.h)));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function overlapRatio(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return 0;
    const intersection = (right - left) * (bottom - top);
    return intersection / Math.max(0.000001, Math.min(a.w * a.h, b.w * b.h));
  }

  function detectLinks(pageIndex) {
    rebuildAliasMap();
    const words = (pageWords[pageIndex] || [])
      .filter(word => Number.isFinite(Number(word.x)) && Number.isFinite(Number(word.y)) && Number(word.w) > 0 && Number(word.h) > 0)
      .slice()
      .sort((a, b) => {
        const dy = centerY(a) - centerY(b);
        return Math.abs(dy) < Math.max(Number(a.h) || 0, Number(b.h) || 0) * 0.75 ? Number(a.x) - Number(b.x) : dy;
      });

    const found = [];
    for (let i = 0; i < words.length; i++) {
      let group = [words[i]];
      for (let length = 1; length <= 3; length++) {
        if (length > 1) {
          const next = words[i + length - 1];
          if (!canJoin(group[group.length - 1], next)) break;
          group.push(next);
        }
        const raw = group.map(word => word.text || '').join('');
        const targetPage = resolveReference(raw);
        if (!targetPage || targetPage === pageIndex + 1) continue;
        const box = combinedBox(group);
        if (box.w > 0.18 || box.h > 0.08) continue;
        const duplicate = found.some(item => item.targetPage === targetPage && overlapRatio(item, box) > 0.55);
        if (!duplicate) found.push({ ...box, targetPage, raw });
      }
    }
    return found;
  }

  function loadExplicitIndex() {
    const path = manifest?.sheetLinkIndex || '';
    if (!path) return Promise.resolve(false);
    if (explicitIndexPromise && explicitIndexPath === path) return explicitIndexPromise;

    explicitIndexPath = path;
    explicitPages.clear();
    explicitIndexPromise = fetch(resolveAsset(path), { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`Linked-sheet index unavailable: ${response.status}`);
        return response.json();
      })
      .then(data => {
        const pages = Array.isArray(data.pages) ? data.pages : [];
        for (const entry of pages) {
          const pageNumber = Number(entry.page);
          if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;
          const links = Array.isArray(entry.links) ? entry.links.filter(link =>
            Number.isFinite(Number(link.x)) &&
            Number.isFinite(Number(link.y)) &&
            Number.isFinite(Number(link.w)) &&
            Number.isFinite(Number(link.h)) &&
            Number.isFinite(Number(link.targetPage))
          ) : [];
          explicitPages.set(pageNumber, links);
        }
        linkCache.clear();
        renderSheetLinks();
        return true;
      })
      .catch(error => {
        console.warn(error);
        return false;
      });

    return explicitIndexPromise;
  }

  function linkedSheetUrl(targetPage) {
    const url = new URL('viewer.html', location.href);
    url.searchParams.set('project', projectId);
    if (new URLSearchParams(location.search).get('mobile') === '1') url.searchParams.set('mobile', '1');
    url.hash = `page=${targetPage}`;
    return url.href;
  }

  function renderSheetLinks() {
    if (!sheetLinkLayer) return;
    sheetLinkLayer.innerHTML = '';
    if (!Array.isArray(sheets) || !sheets.length) return;

    if (manifest?.sheetLinkIndex && !explicitIndexPromise) loadExplicitIndex();

    let links;
    if (explicitPages.has(page)) {
      links = explicitPages.get(page) || [];
    } else {
      if (!pageWords[page - 1]?.length) return;
      const cacheKey = `${projectId}:${manifest?.packageVersion || manifest?.setDate || '1'}:${page}:${pageWords[page - 1].length}`;
      links = linkCache.get(cacheKey);
      if (!links) {
        links = detectLinks(page - 1);
        linkCache.set(cacheKey, links);
      }
    }

    for (const link of links) {
      const targetPage = Number(link.targetPage);
      const target = sheets[targetPage - 1];
      if (!target || targetPage === page) continue;
      const x = Number(link.x), y = Number(link.y), w = Number(link.w), h = Number(link.h);
      const padX = Math.min(0.006, Math.max(0.0015, w * 0.28));
      const padY = Math.min(0.006, Math.max(0.0015, h * 0.35));
      const left = Math.max(0, x - padX);
      const top = Math.max(0, y - padY);
      const anchor = document.createElement('a');
      anchor.className = 'sheetLink';
      anchor.href = linkedSheetUrl(targetPage);
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.style.left = `${left * 100}%`;
      anchor.style.top = `${top * 100}%`;
      anchor.style.width = `${Math.min(1 - left, w + padX * 2) * 100}%`;
      anchor.style.height = `${Math.min(1 - top, h + padY * 2) * 100}%`;
      const label = link.label || `${sheetNumber(target)} - ${sheetTitle(target)}`;
      anchor.title = `Open ${label} in a new tab`;
      anchor.setAttribute('aria-label', `Open ${label} in a new tab`);
      anchor.addEventListener('mousedown', event => event.stopPropagation());
      anchor.addEventListener('pointerdown', event => event.stopPropagation());
      anchor.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
      anchor.addEventListener('touchend', event => event.stopPropagation(), { passive: true });
      anchor.addEventListener('click', event => event.stopPropagation());
      sheetLinkLayer.appendChild(anchor);
    }
  }

  window.renderSheetLinks = renderSheetLinks;

  const originalTransformImage = transformImage;
  transformImage = function linkedTransformImage() {
    const result = originalTransformImage();
    if (sheetLinkLayer) {
      sheetLinkLayer.style.width = `${naturalW * scale}px`;
      sheetLinkLayer.style.height = `${naturalH * scale}px`;
      sheetLinkLayer.style.transform = plan.style.transform;
    }
    return result;
  };

  const originalShowPage = showPage;
  showPage = async function linkedShowPage() {
    const result = await originalShowPage();
    renderSheetLinks();
    return result;
  };

  const originalRenderHighlights = renderHighlights;
  renderHighlights = function linkedRenderHighlights() {
    const result = originalRenderHighlights();
    renderSheetLinks();
    return result;
  };

  let attempts = 0;
  const initialize = setInterval(() => {
    attempts++;
    if (Array.isArray(sheets) && sheets.length && manifest) {
      loadExplicitIndex();
      transformImage();
      renderSheetLinks();
      if (pageWords[page - 1]?.length || explicitPages.has(page) || attempts > 100) clearInterval(initialize);
    } else if (attempts > 100) clearInterval(initialize);
  }, 100);
})();
