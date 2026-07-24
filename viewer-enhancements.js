(() => {
  const collapsedGroups = new Set();
  let groupsInitialized = false;

  function initializeGroups() {
    if (groupsInitialized || !Array.isArray(sheets) || !sheets.length) return;
    for (const sheet of sheets) collapsedGroups.add(sheetGroup(sheet));
    groupsInitialized = true;
  }

  function makeGroupToggle(group, count) {
    const button = document.createElement('button');
    const expanded = !collapsedGroups.has(group);
    button.type = 'button';
    button.className = `groupToggle${expanded ? ' expanded' : ''}`;
    button.setAttribute('aria-expanded', String(expanded));
    button.innerHTML = `<span class="groupChevron">›</span><span class="groupLabel">${esc(group)}</span><span class="groupCount">${count}</span>`;
    button.onclick = () => {
      if (collapsedGroups.has(group)) collapsedGroups.delete(group);
      else collapsedGroups.add(group);
      renderSheets();
    };
    return button;
  }

  renderSheets = function enhancedRenderSheets() {
    const q = $('search').value.trim();
    if (q) {
      renderSearch();
      return;
    }

    initializeGroups();
    const list = $('sheetList');
    list.innerHTML = '';

    const groups = [];
    const byGroup = new Map();
    sheets.forEach((sheet, index) => {
      const group = sheetGroup(sheet);
      if (!byGroup.has(group)) {
        byGroup.set(group, []);
        groups.push(group);
      }
      byGroup.get(group).push({ sheet, index });
    });

    for (const group of groups) {
      const entries = byGroup.get(group);
      list.appendChild(makeGroupToggle(group, entries.length));
      if (collapsedGroups.has(group)) continue;

      for (const { sheet, index } of entries) {
        const button = document.createElement('button');
        button.className = `sheet${index + 1 === page ? ' active' : ''}`;
        button.innerHTML = `<span class="num">${esc(sheetNumber(sheet))}</span><span class="sheetName">${esc(sheetNumber(sheet))} - ${esc(sheetTitle(sheet))}</span>`;
        button.onclick = () => {
          activeSearch = '';
          go(index + 1);
        };
        list.appendChild(button);
      }
    }

    $('count').textContent = `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`;
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const toolbar = document.querySelector('.toolbar');
  const sidebarToggle = document.createElement('button');
  sidebarToggle.id = 'desktopSidebarToggle';
  sidebarToggle.type = 'button';
  sidebarToggle.className = 'btn icon desktopSidebarToggle';
  sidebarToggle.title = 'Open plan list';
  sidebarToggle.setAttribute('aria-label', 'Open plan list');
  sidebarToggle.textContent = '⋯';
  toolbar?.prepend(sidebarToggle);

  function setDesktopSidebarCollapsed(collapsed) {
    if (isMobile) return;
    app.classList.toggle('sidebarCollapsed', collapsed);
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  sidebarToggle.onclick = () => setDesktopSidebarCollapsed(false);

  const originalZoomAt = zoomAt;
  zoomAt = function enhancedZoomAt(mult, clientX, clientY) {
    if (!isMobile && mult > 1 && !app.classList.contains('sidebarCollapsed')) {
      setDesktopSidebarCollapsed(true);
      requestAnimationFrame(() => originalZoomAt(mult, clientX, clientY));
      return;
    }
    return originalZoomAt(mult, clientX, clientY);
  };
})();
