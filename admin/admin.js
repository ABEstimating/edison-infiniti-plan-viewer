'use strict';

const $ = id => document.getElementById(id);
const state = { package: null, validation: null, busy: false, projects: [] };
const SINGLE_LIMIT = 80 * 1024 * 1024;
const PART_SIZE = 20 * 1024 * 1024;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function bytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = size / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[index]}`;
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.style.display = 'none'; }, 3500);
}

async function api(path, options = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { ...(options.body && !(options.body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function setAuthenticated(authenticated) {
  $('loginPanel').hidden = authenticated;
  $('adminApp').hidden = !authenticated;
  $('logoutBtn').hidden = !authenticated;
}

async function checkSession() {
  try {
    const response = await api('session');
    if (!response.setup?.ready) {
      $('setupPanel').hidden = false;
      $('setupMessage').textContent = `Missing: ${(response.setup?.missing || []).join(', ')}.`;
    } else {
      $('setupPanel').hidden = true;
    }
    setAuthenticated(Boolean(response.authenticated));
    if (response.authenticated) await loadProjects();
  } catch (error) {
    $('setupPanel').hidden = false;
    $('setupMessage').textContent = error.message;
    setAuthenticated(false);
  }
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('loginError').hidden = true;
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = '';
    setAuthenticated(true);
    await loadProjects();
  } catch (error) {
    $('loginError').textContent = error.data?.setup?.missing?.length ? `Cloudflare setup is incomplete: ${error.data.setup.missing.join(', ')}.` : error.message;
    $('loginError').hidden = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('logout', { method: 'POST', body: '{}' }); } catch {}
  setAuthenticated(false);
});

function normalizedPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function commonRoot(paths) {
  const clean = paths.filter(Boolean).map(normalizedPath);
  if (!clean.length) return '';
  const first = clean[0].split('/')[0];
  if (!first || clean.some(path => path.split('/')[0] !== first) || clean.some(path => !path.includes('/'))) return '';
  return `${first}/`;
}

function meaningfulPath(path) {
  return path && !path.endsWith('/') && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path) && !path.startsWith('__MACOSX/');
}

function mimeFor(path) {
  const extension = path.split('.').pop().toLowerCase();
  return ({
    json: 'application/json; charset=utf-8', gz: 'application/gzip', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', zip: 'application/zip', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8'
  })[extension] || 'application/octet-stream';
}

function findManifest(paths) {
  return paths.find(path => /^project-[^/]+\.json$/i.test(path)) || '';
}

async function packageFromZip(file) {
  if (!window.JSZip) throw new Error('ZIP reader did not load. Refresh the page and try again.');
  const zip = await JSZip.loadAsync(file);
  const rawPaths = Object.keys(zip.files).filter(path => !zip.files[path].dir && meaningfulPath(path));
  const root = commonRoot(rawPaths);
  const descriptors = rawPaths.map(rawPath => {
    const path = normalizedPath(root && rawPath.startsWith(root) ? rawPath.slice(root.length) : rawPath);
    const entry = zip.files[rawPath];
    return { path, size: Number(entry._data?.uncompressedSize) || 0, getBlob: () => entry.async('blob'), getText: () => entry.async('text') };
  }).filter(item => meaningfulPath(item.path));
  const manifestPath = findManifest(descriptors.map(item => item.path));
  if (!manifestPath) throw new Error('No root-level project-*.json manifest was found in this ZIP.');
  const manifestDescriptor = descriptors.find(item => item.path === manifestPath);
  const manifest = JSON.parse(await manifestDescriptor.getText());
  return { type: 'zip', name: file.name, descriptors, manifestPath, manifest, totalBytes: descriptors.reduce((sum, item) => sum + item.size, 0) };
}

async function packageFromFolder(fileList) {
  const files = Array.from(fileList).filter(file => meaningfulPath(file.webkitRelativePath || file.name));
  if (!files.length) throw new Error('The selected folder is empty.');
  const rawPaths = files.map(file => normalizedPath(file.webkitRelativePath || file.name));
  const root = commonRoot(rawPaths);
  const descriptors = files.map((file, index) => {
    const rawPath = rawPaths[index];
    const path = normalizedPath(root && rawPath.startsWith(root) ? rawPath.slice(root.length) : rawPath);
    return { path, size: file.size, getBlob: async () => file, getText: () => file.text() };
  }).filter(item => meaningfulPath(item.path));
  const manifestPath = findManifest(descriptors.map(item => item.path));
  if (!manifestPath) throw new Error('No root-level project-*.json manifest was found in this folder.');
  const manifestDescriptor = descriptors.find(item => item.path === manifestPath);
  const manifest = JSON.parse(await manifestDescriptor.getText());
  return { type: 'folder', name: root.replace(/\/$/, '') || 'Selected folder', descriptors, manifestPath, manifest, totalBytes: descriptors.reduce((sum, item) => sum + item.size, 0) };
}

function applyPackage(pkg) {
  state.package = pkg;
  state.validation = null;
  $('slug').value = pkg.manifest.projectId || '';
  $('packageName').textContent = pkg.name;
  $('packageMeta').textContent = `${pkg.descriptors.length} files · ${bytes(pkg.totalBytes)} · ${pkg.type === 'zip' ? 'ZIP package' : 'extracted folder'}`;
  $('manifestMeta').textContent = `${pkg.manifest.projectName || 'Unnamed project'} · ${pkg.manifest.setName || 'Plan Set'} · ${Array.isArray(pkg.manifest.sheets) ? pkg.manifest.sheets.length : 0} sheets`;
  $('packageCard').hidden = false;
  $('uploadBtn').disabled = !validSlug($('slug').value);
  $('uploadHint').textContent = 'The project folder will be created automatically in R2.';
  $('validationPanel').hidden = true;
  $('progressPanel').hidden = true;
}

async function chooseZip(file) {
  if (!file) return;
  try {
    setBusy(true, 'Reading ZIP package…');
    applyPackage(await packageFromZip(file));
  } catch (error) {
    toast(error.message);
    clearPackage();
  } finally {
    setBusy(false);
    $('zipInput').value = '';
  }
}

async function chooseFolder(files) {
  if (!files?.length) return;
  try {
    setBusy(true, 'Reading project folder…');
    applyPackage(await packageFromFolder(files));
  } catch (error) {
    toast(error.message);
    clearPackage();
  } finally {
    setBusy(false);
    $('folderInput').value = '';
  }
}

$('zipInput').addEventListener('change', event => chooseZip(event.target.files[0]));
$('folderInput').addEventListener('change', event => chooseFolder(event.target.files));
$('slug').addEventListener('input', () => { $('slug').value = $('slug').value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-'); $('uploadBtn').disabled = !state.package || !validSlug($('slug').value) || state.busy; });
$('clearPackage').addEventListener('click', clearPackage);

function validSlug(value) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || '')); }

function clearPackage() {
  state.package = null;
  state.validation = null;
  $('slug').value = '';
  $('packageCard').hidden = true;
  $('validationPanel').hidden = true;
  $('progressPanel').hidden = true;
  $('uploadBtn').disabled = true;
  $('uploadHint').textContent = 'Choose a ZIP or folder to begin.';
}

function setBusy(busy, message = '') {
  state.busy = busy;
  $('uploadBtn').disabled = busy || !state.package || !validSlug($('slug').value);
  $('publishBtn').disabled = busy || !state.validation?.valid;
  if (message) $('uploadHint').textContent = message;
}

async function directUpload(key, blob, contentType) {
  return api(`object?key=${encodeURIComponent(key)}`, { method: 'PUT', body: blob, headers: { 'content-type': contentType } });
}

async function multipartUpload(key, blob, contentType, onPart) {
  const created = await api('multipart/create', { method: 'POST', body: JSON.stringify({ key, contentType }) });
  const parts = [];
  try {
    const count = Math.ceil(blob.size / PART_SIZE);
    for (let index = 0; index < count; index++) {
      const start = index * PART_SIZE;
      const chunk = blob.slice(start, Math.min(blob.size, start + PART_SIZE));
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const uploaded = await api(`multipart/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(created.uploadId)}&partNumber=${index + 1}`, { method: 'PUT', body: chunk, headers: { 'content-type': 'application/octet-stream' } });
          parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
          onPart?.(chunk.size, index + 1, count);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 900));
        }
      }
      if (lastError) throw lastError;
    }
    return api('multipart/complete', { method: 'POST', body: JSON.stringify({ key, uploadId: created.uploadId, parts }) });
  } catch (error) {
    await api('multipart/abort', { method: 'POST', body: JSON.stringify({ key, uploadId: created.uploadId }) }).catch(() => {});
    throw error;
  }
}

async function uploadDescriptor(slug, descriptor, onBytes) {
  const key = `projects/${slug}/${descriptor.path}`;
  const blob = await descriptor.getBlob();
  if (blob.size > SINGLE_LIMIT) return multipartUpload(key, blob, mimeFor(descriptor.path), amount => onBytes(amount));
  const result = await directUpload(key, blob, mimeFor(descriptor.path));
  onBytes(blob.size);
  return result;
}

async function uploadPackage() {
  if (!state.package || state.busy) return;
  const slug = $('slug').value;
  if (!validSlug(slug)) return toast('Enter a valid lowercase project folder name.');
  if (state.package.manifest.projectId && state.package.manifest.projectId !== slug) return toast(`The manifest projectId is “${state.package.manifest.projectId}”. Use that folder name or update the package manifest.`);

  setBusy(true);
  $('progressPanel').hidden = false;
  $('validationPanel').hidden = true;
  const files = state.package.descriptors.slice().sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let uploadedBytes = 0;
  let uploadedFiles = 0;

  function updateProgress(current = '') {
    const percent = totalBytes ? Math.min(100, Math.round(uploadedBytes / totalBytes * 100)) : Math.round(uploadedFiles / files.length * 100);
    $('progressBar').style.width = `${percent}%`;
    $('progressPercent').textContent = `${percent}%`;
    $('progressFiles').textContent = `${uploadedFiles} / ${files.length} files`;
    $('progressBytes').textContent = `${bytes(uploadedBytes)} / ${bytes(totalBytes)}`;
    $('fileProgress').textContent = current || 'Preparing upload…';
  }

  updateProgress();
  try {
    for (const descriptor of files) {
      $('progressText').textContent = `Uploading ${descriptor.path}`;
      updateProgress(descriptor.path);
      await uploadDescriptor(slug, descriptor, amount => { uploadedBytes += amount; updateProgress(descriptor.path); });
      uploadedFiles++;
      if (!descriptor.size) uploadedBytes += 0;
      updateProgress(descriptor.path);
    }
    uploadedBytes = Math.max(uploadedBytes, totalBytes);
    uploadedFiles = files.length;
    updateProgress('Upload complete. Validating package…');
    $('progressText').textContent = 'Upload complete. Validating project package…';
    const result = await api('validate', { method: 'POST', body: JSON.stringify({ slug }) });
    state.validation = result.validation;
    renderValidation(result.validation);
    toast(result.validation.valid ? 'Project package uploaded and validated.' : 'Upload finished, but validation found problems.');
  } catch (error) {
    $('progressText').textContent = 'Upload stopped.';
    $('fileProgress').textContent = error.message;
    toast(`Upload failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

$('uploadBtn').addEventListener('click', uploadPackage);

function renderValidation(validation) {
  $('validationPanel').hidden = false;
  $('validationBadge').className = `badge ${validation.valid ? 'success' : 'error'}`;
  $('validationBadge').textContent = validation.valid ? 'Ready to publish' : 'Needs correction';
  $('validationSummary').textContent = `${validation.fileCount || 0} files · ${bytes(validation.totalBytes || 0)} · ${validation.sheetCount || 0} sheets`;
  const lines = [];
  if (validation.valid) lines.push('<div class="validationLine success">All required manifest references were found in R2.</div>');
  for (const error of validation.errors || []) lines.push(`<div class="validationLine error"><strong>Error:</strong> ${esc(error)}</div>`);
  for (const warning of validation.warnings || []) lines.push(`<div class="validationLine warning"><strong>Warning:</strong> ${esc(warning)}</div>`);
  $('validationDetails').innerHTML = lines.join('') || '<div class="validationLine success">Validation complete.</div>';
  $('publishBtn').disabled = !validation.valid || state.busy;
  $('openPublished').hidden = true;
  $('validationPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('publishBtn').addEventListener('click', async () => {
  if (!state.validation?.valid || state.busy) return;
  const slug = $('slug').value;
  try {
    setBusy(true);
    $('publishBtn').textContent = 'Publishing…';
    const result = await api('publish', { method: 'POST', body: JSON.stringify({ slug }) });
    $('publishBtn').textContent = 'Published';
    $('publishBtn').disabled = true;
    $('openPublished').href = `../viewer.html?project=${encodeURIComponent(result.project.id)}`;
    $('openPublished').hidden = false;
    toast(`${result.project.name} is now published.`);
    await loadProjects();
  } catch (error) {
    toast(`Publish failed: ${error.message}`);
  } finally {
    $('publishBtn').textContent = 'Publish project';
    setBusy(false);
  }
});

async function loadProjects() {
  const root = $('projectList');
  root.innerHTML = '<div class="emptyState">Loading projects…</div>';
  try {
    const response = await fetch('/api/projects', { cache: 'no-store' });
    if (!response.ok) throw new Error('Project registry unavailable.');
    const data = await response.json();
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    renderProjects();
  } catch (error) {
    root.innerHTML = `<div class="emptyState">${esc(error.message)}</div>`;
  }
}

function renderProjects() {
  const root = $('projectList');
  if (!state.projects.length) { root.innerHTML = '<div class="emptyState">No projects are published.</div>'; return; }
  root.innerHTML = state.projects.map(project => `
    <article class="projectRow">
      <div class="projectMain"><strong>${esc(project.name)}</strong><span>${esc(project.id)} · ${Number(project.sheetCount) || 0} sheets · ${esc(project.storage === 'cloudflare-r2' ? 'R2 storage' : 'legacy site storage')}</span></div>
      <div class="projectActions">
        <a class="secondary small" href="../viewer.html?project=${encodeURIComponent(project.id)}">Open</a>
        <button class="secondary small" data-action="unpublish" data-id="${esc(project.id)}">Unpublish</button>
        ${project.storage === 'cloudflare-r2' ? `<button class="secondary small dangerButton" data-action="delete" data-id="${esc(project.id)}">Delete files</button>` : ''}
      </div>
    </article>`).join('');
}

$('projectList').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || state.busy) return;
  const slug = button.dataset.id;
  if (button.dataset.action === 'unpublish') {
    if (!confirm(`Remove ${slug} from the public project list? The R2 files will remain stored.`)) return;
    try { setBusy(true); await api('unpublish', { method: 'POST', body: JSON.stringify({ slug }) }); toast(`${slug} was unpublished.`); await loadProjects(); } catch (error) { toast(error.message); } finally { setBusy(false); }
  }
  if (button.dataset.action === 'delete') {
    const confirmation = prompt(`This permanently deletes all R2 files for ${slug}. Type the exact project slug to continue:`);
    if (confirmation !== slug) return;
    try { setBusy(true); const result = await api('delete', { method: 'POST', body: JSON.stringify({ slug, confirm: confirmation }) }); toast(`Deleted ${result.deletedFiles} files for ${slug}.`); await loadProjects(); } catch (error) { toast(error.message); } finally { setBusy(false); }
  }
});

$('refreshProjects').addEventListener('click', loadProjects);
checkSession();
