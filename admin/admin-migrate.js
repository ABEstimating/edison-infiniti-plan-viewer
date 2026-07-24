(() => {
  'use strict';

  function legacyReferences(manifest) {
    const values = [];
    const add = value => {
      if (typeof value !== 'string' || !value || /^https?:\/\//i.test(value) || value.startsWith('/')) return;
      values.push(normalizedPath(value.replace(/^\.\//, '')));
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
    if (Array.isArray(sources)) {
      sources.forEach(source => add(source?.path || source?.url || source?.file));
    } else if (sources && typeof sources === 'object') {
      Object.values(sources).forEach(source => add(source?.path || source?.url || source?.file));
    }
    return [...new Set(values.filter(meaningfulPath))];
  }

  async function readLegacyPackage(project) {
    if (!project?.manifest || project.storage === 'cloudflare-r2') throw new Error('This project is already stored in R2.');
    const manifestUrl = new URL(String(project.manifest).replace(/^\/+/, ''), `${location.origin}/`);
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Legacy manifest unavailable (${response.status}).`);
    const manifestText = await response.text();
    const manifest = JSON.parse(manifestText);
    const manifestPath = manifestUrl.pathname.split('/').filter(Boolean).pop() || `project-${project.id}.json`;
    const descriptors = [{
      path: manifestPath,
      size: new Blob([manifestText]).size,
      getBlob: async () => new Blob([manifestText], { type: 'application/json' }),
      getText: async () => manifestText
    }];

    for (const path of legacyReferences(manifest)) {
      const assetUrl = new URL(path, manifestUrl);
      descriptors.push({
        path,
        size: 0,
        getBlob: async () => {
          const assetResponse = await fetch(assetUrl, { cache: 'no-store' });
          if (!assetResponse.ok) throw new Error(`Current website file unavailable (${assetResponse.status}): ${path}`);
          return assetResponse.blob();
        },
        getText: async () => {
          const assetResponse = await fetch(assetUrl, { cache: 'no-store' });
          if (!assetResponse.ok) throw new Error(`Current website file unavailable (${assetResponse.status}): ${path}`);
          return assetResponse.text();
        }
      });
    }

    return {
      type: 'legacy',
      name: `${manifest.projectName || project.name} - current website files`,
      descriptors,
      manifestPath,
      manifest,
      totalBytes: descriptors.reduce((sum, descriptor) => sum + descriptor.size, 0)
    };
  }

  async function uploadLegacyPackage(pkg, slug) {
    const files = pkg.descriptors.slice().sort((a, b) => a.path.localeCompare(b.path));
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    $('progressPanel').hidden = false;
    $('validationPanel').hidden = true;
    $('progressBar').style.width = '0%';
    $('progressPercent').textContent = '0%';
    $('progressFiles').textContent = `0 / ${files.length} files`;
    $('progressBytes').textContent = '0 B transferred';
    $('progressText').textContent = `Copying ${pkg.manifest.projectName || slug} into R2…`;
    $('fileProgress').textContent = 'Preparing migration…';

    const updateProgress = current => {
      const percent = files.length ? Math.round(uploadedFiles / files.length * 100) : 100;
      $('progressBar').style.width = `${percent}%`;
      $('progressPercent').textContent = `${percent}%`;
      $('progressFiles').textContent = `${uploadedFiles} / ${files.length} files`;
      $('progressBytes').textContent = `${bytes(uploadedBytes)} transferred`;
      $('fileProgress').textContent = current || 'Copying project files…';
    };

    for (const descriptor of files) {
      $('progressText').textContent = `Copying ${descriptor.path}`;
      updateProgress(descriptor.path);
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await uploadDescriptor(slug, descriptor, amount => {
            uploadedBytes += amount;
            updateProgress(descriptor.path);
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            $('fileProgress').textContent = `Retrying ${descriptor.path} (${attempt + 1}/3)…`;
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          }
        }
      }
      if (lastError) throw lastError;
      uploadedFiles++;
      updateProgress(descriptor.path);
    }

    $('progressBar').style.width = '100%';
    $('progressPercent').textContent = '100%';
    $('progressText').textContent = 'Copy complete. Validating R2 project…';
    $('fileProgress').textContent = 'Checking every manifest reference…';
    const result = await api('validate', { method: 'POST', body: JSON.stringify({ slug }) });
    state.validation = result.validation;
    renderValidation(result.validation);
    return result.validation;
  }

  async function migrateProject(project, button) {
    if (!project || state.busy) return;
    const slug = project.id;
    if (!confirm(`Move all ${project.name} plan files from the current website into R2 and publish the R2 version? The existing project remains live until validation succeeds.`)) return;

    const originalText = button.textContent;
    try {
      setBusy(true, `Reading current ${project.name} files…`);
      button.textContent = 'Preparing…';
      const pkg = await readLegacyPackage(project);
      applyPackage(pkg);
      setBusy(true, `Copying ${pkg.descriptors.length} files to R2…`);
      button.textContent = 'Moving…';
      const validation = await uploadLegacyPackage(pkg, slug);
      if (!validation.valid) {
        toast('The files copied, but validation found a problem. Review the validation section before publishing.');
        return;
      }

      $('progressText').textContent = 'Validation passed. Publishing R2 project…';
      const result = await api('publish', { method: 'POST', body: JSON.stringify({ slug }) });
      toast(`${result.project.name} was moved to R2 and published.`);
      $('openPublished').href = `../viewer.html?project=${encodeURIComponent(result.project.id)}`;
      $('openPublished').hidden = false;
      await loadProjects();
    } catch (error) {
      $('progressText').textContent = 'Migration stopped.';
      $('fileProgress').textContent = error.message;
      toast(`R2 migration failed: ${error.message}`);
    } finally {
      button.textContent = originalText;
      setBusy(false);
    }
  }

  function addMigrationButtons() {
    const rows = Array.from($('projectList').querySelectorAll('.projectRow'));
    rows.forEach((row, index) => {
      const project = state.projects[index];
      if (!project || project.storage === 'cloudflare-r2') return;
      const actions = row.querySelector('.projectActions');
      if (!actions || actions.querySelector('[data-action="migrate-r2"]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary small';
      button.dataset.action = 'migrate-r2';
      button.dataset.id = project.id;
      button.textContent = 'Move to R2';
      const unpublish = actions.querySelector('[data-action="unpublish"]');
      actions.insertBefore(button, unpublish || null);
    });
  }

  const originalRenderProjects = renderProjects;
  renderProjects = function renderProjectsWithMigration() {
    originalRenderProjects();
    addMigrationButtons();
  };

  $('projectList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action="migrate-r2"]');
    if (!button) return;
    event.preventDefault();
    const project = state.projects.find(item => item.id === button.dataset.id);
    migrateProject(project, button);
  }, true);

  setTimeout(addMigrationButtons, 500);
})();
