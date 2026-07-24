(() => {
  'use strict';

  function addPlanSetButtons() {
    const rows = Array.from($('projectList').querySelectorAll('.projectRow'));
    rows.forEach((row, index) => {
      const project = state.projects[index];
      if (!project || project.storage !== 'cloudflare-r2') return;
      const actions = row.querySelector('.projectActions');
      if (!actions || actions.querySelector('[data-action="add-plan-set"]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary small';
      button.dataset.action = 'add-plan-set';
      button.dataset.id = project.id;
      button.textContent = 'Add plan set';
      const unpublish = actions.querySelector('[data-action="unpublish"]');
      actions.insertBefore(button, unpublish || null);
    });
  }

  const previousRenderProjects = renderProjects;
  renderProjects = function renderProjectsWithPlanSetActions() {
    previousRenderProjects();
    addPlanSetButtons();
  };

  $('projectList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action="add-plan-set"]');
    if (!button) return;
    event.preventDefault();
    const project = state.projects.find(item => item.id === button.dataset.id);
    if (!project) return;
    clearPackage();
    $('slug').value = project.id;
    $('uploadHint').textContent = `Select the prepared additional-set ZIP or folder for ${project.name}. Existing R2 files will remain in place.`;
    document.querySelector('.uploadPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('zipInput').click(), 350);
  }, true);

  setTimeout(addPlanSetButtons, 600);
})();
