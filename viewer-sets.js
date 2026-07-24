(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const requestedView = new URLSearchParams(location.search).get('view') || 'current';

  function isProjectManifestUrl(input) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      return /\/project-[^/]+\.json$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function applyView(data) {
    if (!data || !Array.isArray(data.sheets)) return data;
    const receivedSets = Array.isArray(data.receivedSets) ? data.receivedSets : [];
    let active = null;
    if (requestedView !== 'current') active = receivedSets.find(item => item && item.id === requestedView) || null;

    if (active && Array.isArray(active.sheets) && active.sheets.length) {
      data.sheets = active.sheets;
      data.setName = active.name || data.setName;
      data.activeViewId = active.id;
      for (const key of ['searchIndex', 'searchIndexGzip', 'searchIndexGzipChunks', 'sheetLinkIndex', 'sourcePdf', 'defaultRotation', 'mobileDefaultRotation']) {
        if (active[key] !== undefined) data[key] = active[key];
      }
    } else {
      data.activeViewId = 'current';
      data.setName = data.currentSetName || data.setName;
    }
    return data;
  }

  window.fetch = async function abPlanFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!response.ok || !isProjectManifestUrl(input)) return response;
    try {
      const data = applyView(await response.clone().json());
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
    } catch {
      return response;
    }
  };

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function displayDate(value) {
    if (!value) return 'Not provided';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function addStyles() {
    if (document.getElementById('abSetStyles')) return;
    const style = document.createElement('style');
    style.id = 'abSetStyles';
    style.textContent = `
      .projectInfoButton{width:calc(100% - 20px);height:38px;margin:10px 10px 0;border:1px solid #bed0f5;border-radius:9px;background:#eef4ff;color:#174ea6;font-size:12px;font-weight:800;cursor:pointer;text-align:left;padding:0 12px}
      .projectInfoButton:hover{background:#e3edff}.viewBox{padding:10px 10px 0}.viewBox .label{display:block;margin-bottom:5px}.viewSelect{width:100%;height:38px;border:1px solid #d7dee9;border-radius:8px;background:#fff;padding:0 30px 0 10px;color:#172033;font-size:12px;font-weight:700}
      .versionTool{position:relative}.versionButton{height:32px;padding:0 10px;border:1px solid #d7dee9;border-radius:8px;background:#fff;color:#344054;font-size:10.5px;font-weight:800;cursor:pointer;white-space:nowrap}.versionButton[hidden]{display:none}.versionMenu{position:absolute;right:0;top:38px;width:310px;max-height:320px;overflow:auto;padding:8px;border:1px solid #d7dee9;border-radius:10px;background:#fff;box-shadow:0 18px 45px rgba(15,23,42,.2);z-index:40}.versionMenu[hidden]{display:none}.versionMenu a{display:block;padding:10px;border-radius:8px;color:#172033;text-decoration:none;font-size:11px;line-height:1.35}.versionMenu a:hover{background:#f2f6fc}.versionMenu strong,.versionMenu span{display:block}.versionMenu span{margin-top:2px;color:#667085;font-size:10px}
      .projectInfoModal{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:24px;background:rgba(11,18,32,.62);backdrop-filter:blur(3px)}.projectInfoModal[hidden]{display:none}.projectInfoCard{width:min(880px,96vw);max-height:90vh;overflow:auto;border-radius:16px;background:#fff;box-shadow:0 28px 80px rgba(0,0,0,.35)}.projectInfoHead{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:20px 22px;border-bottom:1px solid #e3e8ef;background:#fff}.projectInfoHead h2{margin:0;font-size:20px}.projectInfoHead p{margin:5px 0 0;color:#667085;font-size:12px}.projectInfoClose{width:34px;height:34px;border:1px solid #d7dee9;border-radius:8px;background:#fff;font-size:20px;cursor:pointer}.projectInfoBody{padding:20px 22px 26px}.infoGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.infoField{padding:12px;border:1px solid #e1e7ef;border-radius:10px;background:#f8fafc}.infoField.wide{grid-column:1/-1}.infoField label{display:block;color:#7b8799;font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.08em}.infoField div{margin-top:5px;color:#172033;font-size:12px;line-height:1.5;white-space:pre-wrap}.infoSection{margin-top:20px}.infoSection h3{margin:0 0 8px;font-size:14px}.infoList{display:grid;gap:8px}.infoItem{padding:11px 12px;border:1px solid #e1e7ef;border-radius:9px;background:#fff;font-size:12px}.infoItem strong,.infoItem span{display:block}.infoItem span{margin-top:3px;color:#667085;font-size:10.5px}.infoItem a{color:#175cd3;text-decoration:none;font-weight:750}.infoEmpty{color:#8a94a6;font-size:12px}
      @media(max-width:760px){.projectInfoModal{padding:8px}.projectInfoCard{width:100%;max-height:96vh}.infoGrid{grid-template-columns:1fr}.infoField.wide{grid-column:auto}.versionTool{display:none}.projectInfoButton{margin-top:8px}}
    `;
    document.head.appendChild(style);
  }

  function documentUrl(item) {
    const path = item?.path || item?.url || '';
    if (!path) return '';
    try { return new URL(path, manifestUrl).href; } catch { return path; }
  }

  function listSection(title, items, formatter) {
    const values = Array.isArray(items) ? items : [];
    return `<section class="infoSection"><h3>${escHtml(title)}</h3>${values.length ? `<div class="infoList">${values.map(formatter).join('')}</div>` : '<div class="infoEmpty">None provided.</div>'}</section>`;
  }

  function buildInfoBody() {
    const info = manifest.projectInfo || {};
    const receivedSets = Array.isArray(manifest.receivedSets) ? manifest.receivedSets : [];
    const field = (label, value, wide = false) => `<div class="infoField${wide ? ' wide' : ''}"><label>${escHtml(label)}</label><div>${escHtml(value || 'Not provided')}</div></div>`;
    const documents = Array.isArray(info.documents) ? info.documents : [];
    return `
      <div class="infoGrid">
        ${field('Project', info.projectName || manifest.projectName)}
        ${field('Address', info.address || manifest.address)}
        ${field('Bid due', info.bidDueDate ? `${displayDate(info.bidDueDate)}${info.bidDueTime ? ` at ${info.bidDueTime}` : ''}` : '')}
        ${field('RFI deadline', info.rfiDueDate ? `${displayDate(info.rfiDueDate)}${info.rfiDueTime ? ` at ${info.rfiDueTime}` : ''}` : '')}
        ${field('Current drawing status', info.currentDrawingStatus || manifest.currentSetStatus || manifest.setName)}
        ${field('Current set', manifest.currentSetName || manifest.setName)}
        ${field('Bid submission instructions', info.bidSubmissionInstructions, true)}
        ${field('RFI submission instructions', info.rfiSubmissionInstructions, true)}
        ${field('Project notes', info.notes, true)}
      </div>
      ${listSection('Received plan sets', receivedSets, item => `<div class="infoItem"><strong>${escHtml(displayDate(item.receivedDate))} - ${escHtml(item.name || item.id)}</strong><span>${escHtml(item.type || 'Plan set')}${item.issueDate ? ` · Drawing issue ${escHtml(displayDate(item.issueDate))}` : ''}${item.status ? ` · ${escHtml(item.status)}` : ''}</span></div>`)}
      ${listSection('Addenda', info.addenda, item => `<div class="infoItem"><strong>${escHtml(item.title || item.name || 'Addendum')}</strong><span>${escHtml(displayDate(item.date || item.receivedDate))}${item.summary ? ` · ${escHtml(item.summary)}` : ''}</span></div>`)}
      ${listSection('RFI responses', info.rfiResponses, item => `<div class="infoItem"><strong>${escHtml(item.title || item.number || 'RFI response')}</strong><span>${escHtml(displayDate(item.date || item.receivedDate))}${item.summary ? ` · ${escHtml(item.summary)}` : ''}</span></div>`)}
      ${listSection('Revisions', info.revisions, item => `<div class="infoItem"><strong>${escHtml(item.title || item.number || 'Revision')}</strong><span>${escHtml(displayDate(item.date || item.receivedDate))}${item.summary ? ` · ${escHtml(item.summary)}` : ''}</span></div>`)}
      ${listSection('Project documents', documents, item => { const href = documentUrl(item); return `<div class="infoItem"><strong>${href ? `<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(item.title || item.name || item.path)}</a>` : escHtml(item.title || item.name || 'Document')}</strong><span>${escHtml(item.type || '')}${item.date ? ` · ${escHtml(displayDate(item.date))}` : ''}</span></div>`; })}
    `;
  }

  function openInfo() {
    const modal = document.getElementById('projectInfoModal');
    modal.querySelector('.projectInfoBody').innerHTML = buildInfoBody();
    modal.hidden = false;
  }

  function closeInfo() {
    const modal = document.getElementById('projectInfoModal');
    if (modal) modal.hidden = true;
  }

  function addInfoModal() {
    if (document.getElementById('projectInfoModal')) return;
    const modal = document.createElement('div');
    modal.id = 'projectInfoModal';
    modal.className = 'projectInfoModal';
    modal.hidden = true;
    modal.innerHTML = `<div class="projectInfoCard" role="dialog" aria-modal="true" aria-labelledby="projectInfoTitle"><div class="projectInfoHead"><div><h2 id="projectInfoTitle">Project Info</h2><p>${escHtml(manifest.projectName || projectEntry?.name || 'AB Plan Viewer')}</p></div><button class="projectInfoClose" type="button" aria-label="Close">×</button></div><div class="projectInfoBody"></div></div>`;
    modal.addEventListener('click', event => { if (event.target === modal) closeInfo(); });
    modal.querySelector('.projectInfoClose').addEventListener('click', closeInfo);
    document.body.appendChild(modal);
  }

  function addSidebarControls() {
    const container = document.querySelector('.sidebar > div:nth-child(2)');
    const setBox = container?.querySelector('.setBox');
    if (!container || !setBox || document.getElementById('projectInfoButton')) return;

    const infoButton = document.createElement('button');
    infoButton.id = 'projectInfoButton';
    infoButton.className = 'projectInfoButton';
    infoButton.type = 'button';
    infoButton.textContent = 'Project Info';
    infoButton.addEventListener('click', openInfo);
    setBox.insertAdjacentElement('afterend', infoButton);

    const receivedSets = Array.isArray(manifest.receivedSets) ? manifest.receivedSets : [];
    if (receivedSets.length) {
      const box = document.createElement('div');
      box.className = 'viewBox';
      box.innerHTML = '<label class="label" for="planViewSelect">Plan view</label><select id="planViewSelect" class="viewSelect"></select>';
      infoButton.insertAdjacentElement('afterend', box);
      const select = box.querySelector('select');
      const currentLabel = manifest.currentSetName || 'Current Set';
      select.add(new Option(`Current Set - ${currentLabel}`, 'current'));
      for (const item of receivedSets) select.add(new Option(`${displayDate(item.receivedDate)} - ${item.name || item.id}`, item.id));
      select.value = manifest.activeViewId || 'current';
      select.addEventListener('change', () => {
        const url = new URL(location.href);
        if (select.value === 'current') url.searchParams.delete('view'); else url.searchParams.set('view', select.value);
        url.hash = 'page=1';
        location.href = url.href;
      });
    }
  }

  function historyForSheet(number) {
    const history = manifest.sheetHistory || {};
    return Array.isArray(history[number]) ? history[number] : Array.isArray(history[String(number).toUpperCase()]) ? history[String(number).toUpperCase()] : [];
  }

  function historyUrl(version) {
    const url = new URL('viewer.html', location.href);
    url.searchParams.set('project', projectId);
    if (version.setId && version.setId !== 'current') url.searchParams.set('view', version.setId);
    if (isMobile) url.searchParams.set('mobile', '1');
    url.hash = `page=${Number(version.page) || 1}`;
    return url.href;
  }

  function updateHistoryControl() {
    const tool = document.getElementById('versionTool');
    if (!tool || !sheets.length) return;
    const button = tool.querySelector('.versionButton');
    const menu = tool.querySelector('.versionMenu');
    const versions = historyForSheet(sheetNumber(currentSheet())).filter(item => item && item.setId !== (manifest.activeViewId || 'current'));
    button.hidden = versions.length === 0;
    menu.hidden = true;
    menu.innerHTML = versions.map(item => `<a href="${escHtml(historyUrl(item))}" target="_blank" rel="noopener"><strong>${escHtml(item.setName || item.label || item.setId || 'Previous version')}</strong><span>Received ${escHtml(displayDate(item.receivedDate))}${item.issueDate ? ` · Issue ${escHtml(displayDate(item.issueDate))}` : ''}</span></a>`).join('');
  }

  function addHistoryControl() {
    if (document.getElementById('versionTool')) return;
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;
    const tool = document.createElement('div');
    tool.id = 'versionTool';
    tool.className = 'versionTool';
    tool.innerHTML = '<button class="versionButton" type="button" hidden>Previous versions</button><div class="versionMenu" hidden></div>';
    tool.querySelector('.versionButton').addEventListener('click', event => {
      event.stopPropagation();
      const menu = tool.querySelector('.versionMenu');
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', event => { if (!tool.contains(event.target)) tool.querySelector('.versionMenu').hidden = true; });
    toolbar.appendChild(tool);
    updateHistoryControl();
  }

  function wrapHeader() {
    if (window.__abHistoryHeaderWrapped || typeof updateHeader !== 'function') return;
    window.__abHistoryHeaderWrapped = true;
    const original = updateHeader;
    updateHeader = function abVersionedHeader() {
      const result = original();
      updateHistoryControl();
      return result;
    };
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (typeof manifest !== 'undefined' && manifest && Array.isArray(sheets) && sheets.length) {
      addStyles();
      addInfoModal();
      addSidebarControls();
      addHistoryControl();
      wrapHeader();
      updateHistoryControl();
      clearInterval(timer);
    } else if (attempts > 200) clearInterval(timer);
  }, 50);

  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeInfo(); });
})();
