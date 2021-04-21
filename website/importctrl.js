// chrome://serviceworker-internals/

if (!self.builds) self.builds = {};

const addBuild = cmdData => {
	console.log('adding files for '+cmdData.buildId);
	self.builds[cmdData.buildId] = cmdData.files;
};

const removeBuild = cmdData => {
	console.log('removing files for '+cmdData.buildId);
	delete self.builds[cmdData.buildId];
};

self.addEventListener('install', e => {
	console.log('installing');
	self.skipWaiting()
});

self.addEventListener('activate', () => {
	console.log('claiming control');
	return self.clients.claim();
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
	event.source.postMessage({type: 'commandCompleted', cmdId});
});

self.addEventListener('fetch', e => {
	for (const [buildId, files] of Object.entries(self.builds)) {
		const pathPos = e.request.url.indexOf(buildId);
		if (pathPos === -1) continue;
		const path = e.request.url.substring(pathPos+buildId.length+1);
		if (files[path] === undefined) return;
		const r = new Response(files[path], {headers: {'Content-Type': 'application/javascript'}});
		e.respondWith(r);
		return;
	}
});

