function keyFromParams(params) {
  const value = params.path;
  const parts = Array.isArray(value) ? value : [value];
  return parts.filter(Boolean).map(decodeURIComponent).join('/');
}

function safeKey(key) {
  return key.startsWith('projects/') && !key.includes('..') && !key.includes('\\') && key.length < 1024;
}

function defaultCacheControl(key) {
  if (/\.(json|txt)$/i.test(key) || /project-[^/]+\.json$/i.test(key)) return 'public, max-age=60, must-revalidate';
  return 'public, max-age=31536000, immutable';
}

export async function onRequest({ request, env, params }) {
  if (!env.PROJECT_FILES) return new Response('R2 binding PROJECT_FILES is not configured.', { status: 503 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });

  const key = keyFromParams(params);
  if (!safeKey(key)) return new Response('Not Found', { status: 404 });

  if (request.method === 'HEAD') {
    const object = await env.PROJECT_FILES.head(key);
    if (!object) return new Response('Not Found', { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('content-length', String(object.size));
    headers.set('accept-ranges', 'bytes');
    if (!headers.has('cache-control')) headers.set('cache-control', defaultCacheControl(key));
    headers.set('x-content-type-options', 'nosniff');
    return new Response(null, { status: 200, headers });
  }

  const hasRange = request.headers.has('range');
  let object;
  try {
    object = await env.PROJECT_FILES.get(key, hasRange ? { range: request.headers } : undefined);
  } catch (error) {
    if (String(error?.message || error).includes('InvalidRange')) return new Response('Range Not Satisfiable', { status: 416 });
    throw error;
  }
  if (!object || !('body' in object)) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('x-content-type-options', 'nosniff');
  if (!headers.has('cache-control')) headers.set('cache-control', defaultCacheControl(key));

  let status = 200;
  if (hasRange && object.range && Number.isFinite(object.range.offset) && Number.isFinite(object.range.length)) {
    const start = object.range.offset;
    const end = start + object.range.length - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(object.range.length));
    status = 206;
  } else {
    headers.set('content-length', String(object.size));
  }

  return new Response(object.body, { status, headers });
}
