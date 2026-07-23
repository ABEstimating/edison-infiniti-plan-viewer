const CACHE='edison-plan-viewer-v3-root-images';
const ASSETS=['./','./index.html',
'./01-cover-sheet.webp',
'./02-existing-conditions-and-removals-plan.webp',
'./03-site-plan.webp',
'./04-grading-and-drainage-plan.webp',
'./05-utility-plan.webp',
'./06-signage-and-landscaping-plan.webp',
'./07-lighting-plan.webp',
'./08-soil-erosion-and-sediment-control-plan.webp',
'./09-soil-erosion-and-sediment-control-notes.webp',
'./10-construction-details-1.webp',
'./11-construction-details-2.webp',
'./s-1-tree-management-plan.webp',
'./s-2-car-carrier-circulation-plan.webp',
'./s-3-fire-truck-circulation-plan.webp'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)))});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(response=>{if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match(event.request)))});
