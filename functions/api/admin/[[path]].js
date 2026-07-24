const COOKIE_NAME = 'ab_admin';
const REGISTRY_KEY = 'registry/projects.json';
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_SINGLE_UPLOAD = 90 * 1024 * 1024;
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

function routeFromParams(params) {
  const value = params.path;
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  return parts.filter(Boolean).join('/');
}

function parseCookies(request) {
  const result = {};
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

async function secureEqual(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) diff |= (left[index] || 0) ^ (right[index] || 0);
  return diff === 0;
}

function setupState(env) {
  const missing = [];
  if (!env.PROJECT_FILES) missing.push('R2 binding PROJECT_FILES');
  if (!env.ADMIN_PASSWORD) missing.push('secret ADMIN_PASSWORD');
  if (!env.SESSION_SECRET) missing.push('secret SESSION_SECRET');
  return { ready: missing.length === 0, missing };
}

async function makeSession(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `${expires}.${nonce}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function verifySession(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresText, nonce, signature] = parts;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(env.SESSION_SECRET, `${expiresText}.${nonce}`);
  return secureEqual(signature, expected);
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

function expiredCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function validSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || '')) && String(value).length <= 100;
}

function validObjectKey(key) {
  return /^projects\/[a-z0-9]+(?:-[a-z0-9]+)*\/.+/.test(key) && !key.includes('..') && !key.includes('\\') && key.length < 1024;
}

function cacheControlFor(key) {
  if (/\.(json|txt)$/i.test(key) || /project-[^/]+\.json$/i.test(key)) return 'public, max-age=60, must-revalidate';
  return 'public, max-age=31536000, immutable';
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON request body.');
  }
}

async function staticRegistry(request, env) {
  if (!env.ASSETS) return { schemaVersion: 1, brand: 'AB Plan Viewer', projects: [] };
  const response = await env.ASSETS.fetch(new Request(new URL('/projects.json', request.url), { headers: { 'cache-control': 'no-cache' } }));
  if (!response.ok) return { schemaVersion: 1, brand: 'AB Plan Viewer', projects: [] };
  return response.json();
}

async function readRegistry(request, env) {
  const object = await env.PROJECT_FILES.get(REGISTRY_KEY);
  if (object) return object.json();
  return staticRegistry(request, env);
}

async function writeRegistry(env, registry) {
  await env.PROJECT_FILES.put(REGISTRY_KEY, JSON.stringify(registry, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
  });
}

async function listAll(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const result = await bucket.list({ prefix, cursor, limit: 1000 });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

function relativeReferencePaths(manifest) {
  const values = [];
  const add = value => {
    if (typeof value !== 'string' || !value || /^https?:\/\//i.test(value) || value.startsWith('/')) return;
    values.push(value.replace(/^\.\//, ''));
  };
  const addMany = value => Array.isArray(value) && value.forEach(add);

  for (const sheet of Array.isArray(manifest.sheets) ? manifest.sheets : []) {
    add(sheet.image ?? sheet.file ?? sheet.f);
    addMany(sheet.chunks);
  }
  add(manifest.searchIndex);
  add(manifest.searchIndexGzip);
  addMany(manifest.searchIndexGzipChunks);
  add(manifest.sheetLinkIndex);
  add(manifest.sourcePdf);
  add(manifest.originalPdf);
  add(manifest.downloadPackage);
  addMany(manifest.assetPack?.chunks);
  const sources = manifest.pdfSources;
  if (Array.isArray(sources)) sources.forEach(source => add(source?.path || source?.url || source?.file));
  else if (sources && typeof sources === 'object') Object.values(sources).forEach(source => add(source?.path || source?.url || source?.file));
  return [...new Set(values)];
}

async function validateProject(env, slug) {
  if (!validSlug(slug)) return { valid: false, errors: ['Invalid project slug.'], warnings: [] };
  const prefix = `projects/${slug}/`;
  const objects = await listAll(env.PROJECT_FILES, prefix);
  const keys = new Set(objects.map(object => object.key));
  const manifestCandidates = objects
    .map(object => object.key)
    .filter(key => key.slice(prefix.length).match(/^project-[^/]+\.json$/i));

  const errors = [];
  const warnings = [];
  if (!objects.length) errors.push(`No files were found under ${prefix}`);
  if (!manifestCandidates.length) errors.push('No project manifest was found at the project folder root.');
  if (manifestCandidates.length > 1) warnings.push(`Multiple project manifests were found; using ${manifestCandidates[0].slice(prefix.length)}.`);
  if (!manifestCandidates.length) return { valid: false, errors, warnings, prefix, fileCount: objects.length, totalBytes: objects.reduce((sum, object) => sum + object.size, 0) };

  const manifestKey = manifestCandidates[0];
  let manifest;
  try {
    manifest = await (await env.PROJECT_FILES.get(manifestKey)).json();
  } catch (error) {
    errors.push(`The manifest is not valid JSON: ${error.message}`);
    return { valid: false, errors, warnings, manifestKey, prefix, fileCount: objects.length, totalBytes: objects.reduce((sum, object) => sum + object.size, 0) };
  }

  const sheets = Array.isArray(manifest.sheets) ? manifest.sheets : [];
  if (!manifest.projectId) errors.push('Manifest is missing projectId.');
  else if (manifest.projectId !== slug) errors.push(`Manifest projectId "${manifest.projectId}" does not match folder slug "${slug}".`);
  if (!manifest.projectName) errors.push('Manifest is missing projectName.');
  if (!sheets.length) errors.push('Manifest contains no plan sheets.');
  if (manifest.sheetCount && Number(manifest.sheetCount) !== sheets.length) warnings.push(`Manifest sheetCount is ${manifest.sheetCount}, but ${sheets.length} sheets are listed.`);

  const referenced = relativeReferencePaths(manifest);
  const missing = referenced.filter(path => !keys.has(`${prefix}${path}`));
  if (missing.length) errors.push(`Missing ${missing.length} referenced file${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`);
  if (!manifest.sourcePdf && !manifest.pdfSources) warnings.push('No source PDF is configured; the viewer will remain in PNG preview mode when zooming.');
  if (!manifest.searchIndex && !manifest.searchIndexGzip && !manifest.searchIndexGzipChunks) warnings.push('No prepared search index is configured.');
  if (!manifest.sheetLinkIndex) warnings.push('No prepared sheet-link index is configured; automatic text detection will be used.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifestKey,
    manifestFile: manifestKey.slice(prefix.length),
    manifest,
    prefix,
    fileCount: objects.length,
    totalBytes: objects.reduce((sum, object) => sum + object.size, 0),
    referencedFileCount: referenced.length,
    sheetCount: sheets.length
  };
}

function projectEntryFromValidation(validation) {
  const manifest = validation.manifest;
  return {
    id: manifest.projectId,
    name: manifest.projectName,
    address: manifest.address || '',
    setName: manifest.setName || 'Plan Set',
    setDate: manifest.setDate || '',
    sheetCount: Number(manifest.sheetCount) || (Array.isArray(manifest.sheets) ? manifest.sheets.length : 0),
    manifest: `/files/${validation.manifestKey}`,
    mobileViewer: 'mobile.html',
    storage: 'cloudflare-r2'
  };
}

async function requireAdmin(request, env) {
  const setup = setupState(env);
  if (!setup.ready) return { response: json({ ok: false, setup }, 503) };
  if (!sameOrigin(request)) return { response: json({ ok: false, error: 'Cross-origin request blocked.' }, 403) };
  if (!(await verifySession(request, env))) return { response: json({ ok: false, error: 'Authentication required.' }, 401) };
  return { response: null };
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = routeFromParams(params);
  const setup = setupState(env);

  try {
    if (route === 'session' && request.method === 'GET') {
      return json({ ok: true, authenticated: setup.ready ? await verifySession(request, env) : false, setup });
    }

    if (route === 'login' && request.method === 'POST') {
      if (!sameOrigin(request)) return json({ ok: false, error: 'Cross-origin request blocked.' }, 403);
      if (!setup.ready) return json({ ok: false, setup }, 503);
      const body = await requestJson(request);
      if (!(await secureEqual(body.password || '', env.ADMIN_PASSWORD))) return json({ ok: false, error: 'Incorrect password.' }, 401);
      const token = await makeSession(env);
      return json({ ok: true, authenticated: true }, 200, { 'set-cookie': sessionCookie(token) });
    }

    if (route === 'logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': expiredCookie() });
    }

    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;

    if (route === 'object' && request.method === 'PUT') {
      const url = new URL(request.url);
      const key = url.searchParams.get('key') || '';
      if (!validObjectKey(key)) return json({ ok: false, error: 'Invalid R2 object key.' }, 400);
      if (!request.body) return json({ ok: false, error: 'Missing upload body.' }, 400);
      const length = Number(request.headers.get('content-length')) || 0;
      if (length > MAX_SINGLE_UPLOAD) return json({ ok: false, error: 'File is too large for a single upload. Use multipart upload.' }, 413);
      const contentType = request.headers.get('content-type') || 'application/octet-stream';
      const object = await env.PROJECT_FILES.put(key, request.body, {
        httpMetadata: { contentType, cacheControl: cacheControlFor(key) }
      });
      return json({ ok: true, key, etag: object?.httpEtag || '', size: object?.size || length });
    }

    if (route === 'multipart/create' && request.method === 'POST') {
      const body = await requestJson(request);
      const key = String(body.key || '');
      if (!validObjectKey(key)) return json({ ok: false, error: 'Invalid R2 object key.' }, 400);
      const upload = await env.PROJECT_FILES.createMultipartUpload(key, {
        httpMetadata: { contentType: body.contentType || 'application/octet-stream', cacheControl: cacheControlFor(key) }
      });
      return json({ ok: true, key: upload.key, uploadId: upload.uploadId });
    }

    if (route === 'multipart/part' && request.method === 'PUT') {
      const url = new URL(request.url);
      const key = url.searchParams.get('key') || '';
      const uploadId = url.searchParams.get('uploadId') || '';
      const partNumber = Number(url.searchParams.get('partNumber'));
      if (!validObjectKey(key) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return json({ ok: false, error: 'Invalid multipart upload parameters.' }, 400);
      if (!request.body) return json({ ok: false, error: 'Missing part body.' }, 400);
      const upload = env.PROJECT_FILES.resumeMultipartUpload(key, uploadId);
      const part = await upload.uploadPart(partNumber, request.body);
      return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
    }

    if (route === 'multipart/complete' && request.method === 'POST') {
      const body = await requestJson(request);
      const key = String(body.key || '');
      if (!validObjectKey(key) || !body.uploadId || !Array.isArray(body.parts) || !body.parts.length) return json({ ok: false, error: 'Invalid multipart completion request.' }, 400);
      const upload = env.PROJECT_FILES.resumeMultipartUpload(key, body.uploadId);
      const object = await upload.complete(body.parts);
      return json({ ok: true, key: object.key, etag: object.httpEtag, size: object.size });
    }

    if (route === 'multipart/abort' && request.method === 'POST') {
      const body = await requestJson(request);
      const key = String(body.key || '');
      if (!validObjectKey(key) || !body.uploadId) return json({ ok: false, error: 'Invalid multipart abort request.' }, 400);
      await env.PROJECT_FILES.resumeMultipartUpload(key, body.uploadId).abort();
      return json({ ok: true });
    }

    if (route === 'validate' && request.method === 'POST') {
      const body = await requestJson(request);
      return json({ ok: true, validation: await validateProject(env, String(body.slug || '')) });
    }

    if (route === 'publish' && request.method === 'POST') {
      const body = await requestJson(request);
      const slug = String(body.slug || '');
      const validation = await validateProject(env, slug);
      if (!validation.valid) return json({ ok: false, error: 'Project package did not pass validation.', validation }, 400);
      const registry = await readRegistry(request, env);
      registry.schemaVersion ||= 1;
      registry.brand ||= 'AB Plan Viewer';
      registry.projects = Array.isArray(registry.projects) ? registry.projects : [];
      const entry = projectEntryFromValidation(validation);
      const index = registry.projects.findIndex(project => project.id === entry.id);
      if (index >= 0) registry.projects[index] = entry;
      else registry.projects.push(entry);
      await writeRegistry(env, registry);
      return json({ ok: true, project: entry, registry });
    }

    if (route === 'unpublish' && request.method === 'POST') {
      const body = await requestJson(request);
      const slug = String(body.slug || '');
      if (!validSlug(slug)) return json({ ok: false, error: 'Invalid project slug.' }, 400);
      const registry = await readRegistry(request, env);
      registry.projects = (Array.isArray(registry.projects) ? registry.projects : []).filter(project => project.id !== slug);
      await writeRegistry(env, registry);
      return json({ ok: true, registry });
    }

    if (route === 'delete' && request.method === 'POST') {
      const body = await requestJson(request);
      const slug = String(body.slug || '');
      if (!validSlug(slug) || body.confirm !== slug) return json({ ok: false, error: 'Deletion confirmation does not match the project slug.' }, 400);
      const prefix = `projects/${slug}/`;
      const objects = await listAll(env.PROJECT_FILES, prefix);
      for (let index = 0; index < objects.length; index += 1000) await env.PROJECT_FILES.delete(objects.slice(index, index + 1000).map(object => object.key));
      const registry = await readRegistry(request, env);
      registry.projects = (Array.isArray(registry.projects) ? registry.projects : []).filter(project => project.id !== slug);
      await writeRegistry(env, registry);
      return json({ ok: true, deletedFiles: objects.length, registry });
    }

    if (route === 'objects' && request.method === 'GET') {
      const prefix = new URL(request.url).searchParams.get('prefix') || 'projects/';
      if (!prefix.startsWith('projects/') || prefix.includes('..')) return json({ ok: false, error: 'Invalid prefix.' }, 400);
      const objects = await listAll(env.PROJECT_FILES, prefix);
      return json({ ok: true, objects: objects.map(object => ({ key: object.key, size: object.size, uploaded: object.uploaded })) });
    }

    return json({ ok: false, error: 'Not Found' }, 404);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error?.message || String(error) }, 500);
  }
}
