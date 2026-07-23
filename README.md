# AB Plan Viewer

Manifest-driven, multi-project construction plan viewer.

- `index.html` — project dashboard
- `viewer.html` — responsive desktop/mobile viewer
- `projects.json` — project registry
- `project-*.json` — prepared project manifests
- `mobile.html` — backwards-compatible redirect to the responsive viewer

Prepared packages should include sheet images, the source PDF, project/extension metadata, and preferably a prebuilt search index with normalized word coordinates. The viewer falls back to native PDF text extraction and browser OCR for older projects that do not yet have a prepared search index.

Viewer controls intercept Ctrl/Cmd + mouse-wheel and Ctrl/Cmd +/-/0 so those commands zoom the plan canvas instead of changing the browser zoom level.
