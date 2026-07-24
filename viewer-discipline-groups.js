(() => {
  'use strict';
  if (typeof renderSheets !== 'function') return;

  const clean = value => String(value || '').trim();
  const normalized = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function canonicalMajor(value) {
    const text = normalized(value);
    if (!text) return '';
    if (/\b(architectural|architecture|interiors?)\b/.test(text)) return 'Architectural';
    if (/\b(structural|structure)\b/.test(text)) return 'Structural';
    if (/\b(mechanical|hvac)\b/.test(text)) return 'Mechanical';
    if (/\b(plumbing)\b/.test(text)) return 'Plumbing';
    if (/\b(electrical|electric|lighting|power)\b/.test(text)) return 'Electrical';
    if (/\b(civil|sitework|site work)\b/.test(text)) return 'Civil';
    if (/\b(landscape|landscaping|irrigation)\b/.test(text)) return 'Landscape';
    if (/\b(fire protection|sprinkler)\b/.test(text)) return 'Fire Protection';
    if (/\b(fire alarm)\b/.test(text)) return 'Fire Alarm';
    if (/\b(technology|telecom|communications|low voltage|audio visual|security)\b/.test(text)) return 'Technology / Low Voltage';
    if (/\b(general|cover|code|life safety)\b/.test(text)) return 'General';
    return '';
  }

  function majorFromNumber(number) {
    const token = clean(number).toUpperCase().replace(/^[^A-Z]+/, '');
    const prefix = (token.match(/^[A-Z]+/) || [''])[0];
    if (!prefix) return '';
    if (/^(FP|FS|SP)/.test(prefix)) return 'Fire Protection';
    if (/^(FA)/.test(prefix)) return 'Fire Alarm';
    if (/^(LV|IT|TC|T|AV|SEC)/.test(prefix)) return 'Technology / Low Voltage';
    if (/^(ID|I|A)/.test(prefix)) return 'Architectural';
    if (/^S/.test(prefix)) return 'Structural';
    if (/^M/.test(prefix)) return 'Mechanical';
    if (/^P/.test(prefix)) return 'Plumbing';
    if (/^E/.test(prefix)) return 'Electrical';
    if (/^C/.test(prefix)) return 'Civil';
    if (/^L/.test(prefix)) return 'Landscape';
    if (/^(G|T)/.test(prefix)) return 'General';
    return '';
  }

  function majorDiscipline(sheet) {
    const explicit = sheet.majorDiscipline ?? sheet.majorGroup ?? sheet.disciplineGroup ?? sheet.category;
    return canonicalMajor(explicit)
      || majorFromNumber(sheetNumber(sheet))
      || canonicalMajor(`${sheetGroup(sheet)} ${sheetTitle(sheet)}`)
      || 'Other Plans';
  }

  function subsection(sheet, major) {
    const group = clean(sheetGroup(sheet));
    if (!group || normalized(group) === normalized(major) || normalized(group) === 'plans') return '';
    return group;
  }

  renderSheets = function groupedRenderSheets() {
    const q = $('search').value.trim();
    if (q) {
      renderSearch();
      return;
    }

    const list = $('sheetList');
    list.innerHTML = '';
    let lastMajor = '';
    let lastSubsection = '';

    sheets.forEach((sheet, index) => {
      const major = majorDiscipline(sheet);
      const sub = subsection(sheet, major);

      if (major !== lastMajor) {
        const header = document.createElement('div');
        header.className = 'majorGroup';
        header.textContent = major;
        list.appendChild(header);
        lastMajor = major;
        lastSubsection = '';
      }

      if (sub && sub !== lastSubsection) {
        const header = document.createElement('div');
        header.className = 'group subgroup';
        header.textContent = sub;
        list.appendChild(header);
        lastSubsection = sub;
      }

      const button = document.createElement('button');
      button.className = 'sheet' + (index + 1 === page ? ' active' : '');
      button.innerHTML = `<span class="num">${esc(sheetNumber(sheet))}</span><span class="sheetName">${esc(sheetNumber(sheet))} - ${esc(sheetTitle(sheet))}</span>`;
      button.onclick = () => {
        activeSearch = '';
        go(index + 1);
      };
      list.appendChild(button);
    });

    $('count').textContent = `${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`;
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  window.abMajorDiscipline = majorDiscipline;
})();
