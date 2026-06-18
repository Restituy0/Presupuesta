const CACHE='presupuesta-v4';
const ASSETS=['./','./index.html','./manifest.json','./icons/icon.svg',
  './js/supabase-client.js','./js/offline-queue.js','./js/data-layer.js','./js/auth-ui.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  // Nunca cachear llamadas a Supabase — siempre red o falla (la cola offline maneja eso)
  if(e.request.url.includes('supabase.co'))return;
  e.respondWith(fetch(e.request).then(r=>{caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r}).catch(()=>caches.match(e.request)));
});
