'use strict';
const CACHE = 'global-tycoon-v2';
const CORE = [
  './',
  './index.html',
  './style.css',
  './client.js',
  './map-bg.png',
  './manifest.webmanifest',
  './icon.svg'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isNav = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if (isNav) {
    // HTML/导航：网络优先，失败回退缓存，保证更新即时生效
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  // 静态资源：缓存优先 + 网络回退并写入缓存（资源 URL 带版本号，版本更新即换 URL）
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
