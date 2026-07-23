const DEAD_CACHE_PREFIX='edison-plan-viewer';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(DEAD_CACHE_PREFIX)).map(k=>caches.delete(k)));
    await self.registration.unregister();
    const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clientsList){client.navigate(client.url);}
  })());
});
self.addEventListener('fetch',()=>{});
