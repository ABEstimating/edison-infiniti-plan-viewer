(() => {
  const collapsedGroups = new Set();
  let groupsInitialized = false;
  let mobileActiveDiscipline = '';

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

  function majorForSheet(sheet) {
    if (typeof window.abMajorDiscipline === 'function') return window.abMajorDiscipline(sheet);
    return sheetGroup(sheet) || 'Plans';
  }

  function buildMobileDisciplines() {
    const groups = [];
    const byDiscipline = new Map();
    sheets.forEach((sheet, index) => {
      const discipline = majorForSheet(sheet);
      if (!byDiscipline.has(discipline)) {
        byDiscipline.set(discipline, []);
        groups.push(discipline);
      }
      byDiscipline.get(discipline).push({ sheet, index });
    });
    return { groups, byDiscipline };
  }

  function renderMobileAccordion(groups, byDiscipline) {
    const list = $('sheetList');
    list.innerHTML = '';
    $('sidebar')?.classList.remove('mobileDisciplineFocus');

    const currentDiscipline = majorForSheet(currentSheet());
    if (!mobileActiveDiscipline || !byDiscipline.has(mobileActiveDiscipline)) {
      mobileActiveDiscipline = currentDiscipline;
    }

    const heading = document.createElement('div');
    heading.className = 'mobileDisciplineIntro';
    heading.innerHTML = '<strong>Plan disciplines</strong><span>Tap a discipline to expand or collapse its sheets.</span>';
    list.appendChild(heading);

    for (const discipline of groups) {
      const entries = byDiscipline.get(discipline) || [];
      const expanded = mobileActiveDiscipline === discipline;
      const section = document.createElement('section');
      section.className = `mobileDisciplineSection${expanded ? ' expanded' : ''}`;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `mobileDisciplineButton${discipline === currentDiscipline ? ' current' : ''}`;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML = `<span><strong>${esc(discipline)}</strong><small>${entries.length} sheet${entries.length === 1 ? '' : 's'}</small></span><span class="mobileDisciplineArrow">›</span>`;
      toggle.onclick = () => {
        mobileActiveDiscipline = expanded ? '' : discipline;
        renderSheets();
        requestAnimationFrame(() => {
          const next = [...document.querySelectorAll('.mobileDisciplineButton')].find(button => button.textContent.includes(discipline));
          next?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      };
      section.appendChild(toggle);

      if (expanded) {
        const content = document.createElement('div');
        content.className = 'mobileDisciplineContent';
        let lastSubsection = '';

        for (const { sheet, index } of entries) {
          const subsection = sheetGroup(sheet) || discipline;
          if (subsection !== lastSubsection) {
            const sub = document.createElement('div');
            sub.className = 'mobileSubsection';
            sub.textContent = subsection;
            content.appendChild(sub);
            lastSubsection = subsection;
          }

          const button = document.createElement('button');
          button.className = `sheet${index + 1 === page ? ' active' : ''}`;
          button.innerHTML = `<span class="num">${esc(sheetNumber(sheet))}</span><span class="sheetName">${esc(sheetNumber(sheet))} - ${esc(sheetTitle(sheet))}</span>`;
          button.onclick = () => {
            activeSearch = '';
            go(index + 1);
          };
          content.appendChild(button);
        }

        section.appendChild(content);
      }

      list.appendChild(section);
    }

    list.querySelector('.sheet.active')?.scrollIntoView({ block: 'nearest' });
  }

  function renderDesktopGroups() {
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
  }

  renderSheets = function enhancedRenderSheets() {
    const q = $('search').value.trim();
    if (q) {
      $('sidebar')?.classList.remove('mobileDisciplineFocus');
      renderSearch();
      return;
    }

    if (isMobile) {
      const { groups, byDiscipline } = buildMobileDisciplines();
      renderMobileAccordion(groups, byDiscipline);
    } else {
      renderDesktopGroups();
    }

    $('count').textContent = `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`;
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
    const wasCollapsed = !isMobile && app.classList.contains('sidebarCollapsed');

    if (!isMobile && mult > 1 && !wasCollapsed) {
      setDesktopSidebarCollapsed(true);
      requestAnimationFrame(() => originalZoomAt(mult, clientX, clientY));
      return;
    }

    const result = originalZoomAt(mult, clientX, clientY);

    if (!isMobile && mult < 1 && wasCollapsed) {
      requestAnimationFrame(() => setDesktopSidebarCollapsed(false));
    }

    return result;
  };
})();