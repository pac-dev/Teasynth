/**
 * This service worker does 2 things:
 * - Serve back files from "builds" provided by the user. This allows
 *   user-provided ES modules to import each other.
 * - If PWA support is enabled when running `teasynth.js generate-editor`, this
 *   also does typical PWA caching so the app can work offline.
 * 
 * For reference: chrome://serviceworker-internals/
 */

const cacheName = 'cache name gets generated here';
const cachedPaths = [/*cached paths get generated here*/];

if (!self.builds) self.builds = {};

const addBuild = cmdData => {
	self.builds[cmdData.buildId] = cmdData.files;
};

const removeBuild = cmdData => {
	delete self.builds[cmdData.buildId];
};

self.addEventListener('install', (e) => {
	e.waitUntil((async () => {
		await self.skipWaiting();
		const cache = await caches.open(cacheName);
		await cache.addAll(cachedPaths);
	})());
});

self.addEventListener('activate', (e) => {
	e.waitUntil((async () => {
		self.clients.claim();
		for (const key of await caches.keys()) {
			if (key !== cacheName) await caches.delete(key);
		}
	})());
});

addEventListener('message', event => {
	// type: 'command', cmdId, cmdData
	if (event.data.type !== 'command') return;
	const cmdId = event.data.cmdId;
	const cmdData = event.data.cmdData;
	if (cmdData.type === 'addBuild')
		addBuild(cmdData);
	else if (cmdData.type === 'removeBuild')
		removeBuild(cmdData);
	else if (cmdData.type === 'claim') {
		return self.clients.claim();
	}
	event.source.postMessage({type: 'commandCompleted', cmdId});
});

self.addEventListener('fetch', e => {
	// e.request.url: https://example.com/teasynth/udxq1q/main.js
	// registration.scope: https://example.com/teasynth/
	const path = e.request.url.substring(self.registration.scope.length);
	for (const files of Object.values(self.builds)) {
		if (files[path] === undefined) continue;
		const r = new Response(files[path], {headers: {'Content-Type': 'application/javascript'}});
		e.respondWith(r);
		return;
	}
	if (cachedPaths.length) e.respondWith(
		caches.match(e.request).then(function(response) {
			return response || fetch(e.request);
		})
	);
});

