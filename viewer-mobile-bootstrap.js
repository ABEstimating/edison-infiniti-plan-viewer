(() => {
  'use strict';
  if (typeof isMobile === 'undefined' || !isMobile) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function mobileManifestFetch(input, init) {
    const response = await nativeFetch(input, init);
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return response; }
    if (!response.ok || !/\/project-[^/]+\.json$/i.test(url.pathname)) return response;
    try {
      const data = await response.clone().json();
      data.cacheProjectOnLoad = false;
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
    } catch {
      return response;
    }
  };

  if (typeof loadPreparedIndex === 'function') {
    const originalLoadPreparedIndex = loadPreparedIndex;
    let firstCall = true;
    let backgroundPromise = null;
    loadPreparedIndex = async function mobilePreparedIndex() {
      if (firstCall) {
        firstCall = false;
        backgroundPromise = new Promise(resolve => setTimeout(resolve, 500)).then(() => originalLoadPreparedIndex());
        return false;
      }
      return backgroundPromise || originalLoadPreparedIndex();
    };
  }
})();
