const REGISTRY_KEY = 'registry/projects.json';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function readStaticRegistry(request, env) {
  if (!env.ASSETS) throw new Error('Static assets binding unavailable');
  const url = new URL('/projects.json', request.url);
  const response = await env.ASSETS.fetch(new Request(url, { headers: { 'cache-control': 'no-cache' } }));
  if (!response.ok) throw new Error('Static project registry unavailable');
  return response.json();
}

export async function onRequestGet({ request, env }) {
  try {
    if (env.PROJECT_FILES) {
      const object = await env.PROJECT_FILES.get(REGISTRY_KEY);
      if (object) return json(await object.json());
    }
    return json(await readStaticRegistry(request, env));
  } catch (error) {
    return json({ schemaVersion: 1, brand: 'AB Plan Viewer', projects: [], error: error.message }, 503);
  }
}
