(() => {
  'use strict';
  if (typeof isMobile === 'undefined' || !isMobile || !scroll) return;

  let pinching = false;
  let sharpTimer = 0;
  let landscapeFitScale = 0;

  const isLandscape = () => window.matchMedia('(orientation: landscape)').matches;

  const refreshSharpPdf = delay => {
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(() => {
      if (typeof zoomAt === 'function') zoomAt(1);
    }, delay);
  };

  const setLandscapeSidebar = visible => {
    if (!isLandscape()) {
      app.classList.remove('landscapeSidebarVisible');
      return;
    }
    app.classList.toggle('landscapeSidebarVisible', visible);
    if (visible) {
      app.classList.remove('hiddenBars');
      $('sidebar')?.classList.remove('open');
      $('shade')?.classList.remove('open');
    } else {
      app.classList.add('hiddenBars');
    }
  };

  const updateLandscapeSidebar = () => {
    if (!isLandscape()) {
      app.classList.remove('landscapeSidebarVisible');
      return;
    }
    if (!landscapeFitScale && mode === 'page' && Number.isFinite(scale)) landscapeFitScale = scale;
    if (!landscapeFitScale) {
      setLandscapeSidebar(true);
      return;
    }

    const visible = app.classList.contains('landscapeSidebarVisible');
    if (visible && scale > landscapeFitScale * 1.10) setLandscapeSidebar(false);
    else if (!visible && scale <= landscapeFitScale * 1.03) setLandscapeSidebar(true);
  };

  const originalFit = fit;
  fit = function mobileLandscapeFit(which = mode) {
    if (isLandscape() && which === 'page') setLandscapeSidebar(true);
    const result = originalFit(which);
    if (isLandscape() && which === 'page') {
      landscapeFitScale = scale;
      setLandscapeSidebar(true);
    }
    return result;
  };

  requestAnimationFrame(() => {
    if (isLandscape()) setLandscapeSidebar(true);
  });

  scroll.addEventListener('touchstart', event => {
    if (!isLandscape()) closeSidebar();
    if (event.touches.length >= 2) {
      pinching = true;
      if (!isLandscape()) app.classList.add('hiddenBars');
    }
  }, { passive: true });

  scroll.addEventListener('touchmove', event => {
    if (event.touches.length >= 2) {
      pinching = true;
      if (isLandscape()) updateLandscapeSidebar();
      else app.classList.add('hiddenBars');
      refreshSharpPdf(260);
    }
  }, { passive: true });

  scroll.addEventListener('touchend', event => {
    if (pinching && event.touches.length < 2) {
      pinching = false;
      if (isLandscape()) updateLandscapeSidebar();
      refreshSharpPdf(70);
    }
  }, { passive: true });

  window.addEventListener('orientationchange', () => {
    landscapeFitScale = 0;
    setTimeout(() => {
      if (isLandscape()) {
        setLandscapeSidebar(true);
        if (typeof fit === 'function') fit('page');
      } else {
        app.classList.remove('landscapeSidebarVisible');
        app.classList.remove('hiddenBars');
      }
    }, 320);
  });
})();
