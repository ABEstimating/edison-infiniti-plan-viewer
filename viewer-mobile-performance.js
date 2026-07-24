(() => {
  'use strict';
  if (typeof isMobile === 'undefined' || !isMobile || !scroll) return;

  let pinching = false;
  let sharpTimer = 0;

  const refreshSharpPdf = delay => {
    clearTimeout(sharpTimer);
    sharpTimer = setTimeout(() => {
      if (typeof zoomAt === 'function') zoomAt(1);
    }, delay);
  };

  scroll.addEventListener('touchstart', event => {
    closeSidebar();
    if (event.touches.length >= 2) {
      pinching = true;
      app.classList.add('hiddenBars');
    }
  }, { passive: true });

  scroll.addEventListener('touchmove', event => {
    if (event.touches.length >= 2) {
      pinching = true;
      app.classList.add('hiddenBars');
      refreshSharpPdf(260);
    }
  }, { passive: true });

  scroll.addEventListener('touchend', event => {
    if (pinching && event.touches.length < 2) {
      pinching = false;
      refreshSharpPdf(70);
    }
  }, { passive: true });
})();
