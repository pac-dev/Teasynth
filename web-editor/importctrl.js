// chrome://serviceworker-internals/

if (!self.builds) self.builds = {};

const addBuild = cmdData => {
	console.log('Adding files for '+cmdData.buildId);
	self.builds[cmdData.buildId] = cmdData.files;
};

const removeBuild = cmdData => {
	console.log('Removing files for '+cmdData.buildId);
	delete self.builds[cmdData.buildId];
};

self.addEventListener('install', e => {
	self.skipWaiting()
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
	// e.request.url eg: http://localhost/tg/udxq1q/main.js
	// registration.scope eg: http://localhost/tg/
	const path = e.request.url.substring(self.registration.scope.length);
	for (const files of Object.values(self.builds)) {
		if (files[path] === undefined) continue;
		const r = new Response(files[path], {headers: {'Content-Type': 'application/javascript'}});
		e.respondWith(r);
		return;
	}
});
