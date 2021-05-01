import { JSZip } from './lib/jszipModule.js';
import { Project } from './Project.js';

/** @param {Project} proj */
export const proj2zip = async proj => {
	const zip = new JSZip();
	proj.getFiles().forEach(f => zip.file(f.path, f.content))
	return await zip.generateAsync({type:'blob'});
};

/** @param {File} file */
export const zip2proj = async file => {
	const zip = await JSZip.loadAsync(file);
	const proj = new Project(file.name.substr(0, file.name.lastIndexOf('.')));
	const entries = [];
	zip.forEach((path, obj) => entries.push({path, obj}));
	for (let {path, obj} of entries) {
		if (obj.dir) {
			proj.addDir(path);
		} else {
			const content = await obj.async('string');
			proj.addFile(path, content);
		}
	}
	return proj;
};

/** @type {ServiceWorker} */
let service;
/** @type {AudioContext} */
let audioContext;
/** @type {AudioWorkletNode} */
let mainNode;
let buildId, urlBase;

const serviceCommand = async cmdData => {
	const cmdId = Math.random().toString(36).substring(7);
	return await new Promise((resolve, reject) => {
		/** @param {MessageEvent} event */
		const listener = event => {
			const data = event.data;
			if (data.type === 'commandCompleted' && data.cmdId === cmdId) {
				navigator.serviceWorker.removeEventListener('message', listener);
				resolve(data);
			} else if (data.type === 'commandFailed' && data.cmdId === cmdId) {
				navigator.serviceWorker.removeEventListener('message', listener);
				reject(data.info);
			}
		};
		navigator.serviceWorker.addEventListener('message', listener);
		service.postMessage({type: 'command', cmdId, cmdData});
	});
};

export const initService = async _urlBase => {
	urlBase = _urlBase;
	await navigator.serviceWorker.register(urlBase+'importctrl.js');
	const reg = await navigator.serviceWorker.ready;
	service = reg.active;
	await serviceCommand({type: 'claim'});
	console.log('Service worker ready');
};

const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

export const stop = async () => {
	if (!service) throw new Error('Service worker not ready.');
	if (mainNode) {
		mainNode.disconnect();
		mainNode = undefined;
	}
	if (audioContext) {
		audioContext.close();
		audioContext = undefined;
	}
	await serviceCommand({type: 'removeBuild', buildId});
	buildId = undefined;
};

/** @param {Project} proj */
export const play = async proj => {
	if (!service) throw new Error('Service worker not ready.');
	await stop();
	buildId = Math.random().toString(36).substring(7);
	console.log('new build id: '+buildId);
	const files = Object.fromEntries(proj.getFiles().map(f => [
		buildId+'/'+f.path, f.content
	]));
	let metaFile = `
	const fileContents = {};
	export const getFileText = path => fileContents[path];`;
	for (let file of proj.getFiles()) {
		metaFile += `
		fileContents[${JSON.stringify(file.path)}] = ${JSON.stringify(file.content)};
		`;
	}
	files[buildId+'/platform/files.js'] = metaFile;
	await serviceCommand({ type: 'addBuild', buildId, files});
	const preRun = await import(`${urlBase}${buildId}/main.js`);
	const sampleRate = preRun.sampleRate ?? 44100;
	if (!preRun.process) throw new Error('main.js must export a "process" function!');
	let preOut = await preRun.process();
	let isAsync = false;
	if (typeof preOut === 'function') {
		preOut = preOut();
		isAsync = true;
	}
	let processWrapper;
	if (typeof preOut === 'number') {
		processWrapper = `
		const s = this.mainProcess();
		channels[0][i] = s;
		channels[1][i] = s;`;
	} else if (preOut.length === 1) {
		processWrapper = `
		const s = this.mainProcess()[0];
		channels[0][i] = s;
		channels[1][i] = s;`;
	} else if (preOut.length === 2) {
		processWrapper = `
		const [s1, s2] = this.mainProcess();
		channels[0][i] = s1;
		channels[1][i] = s2;`;
	} else throw new Error(`process returned ${preOut} (${typeof preOut})! `
		+'It should return a number or an array of one or two numbers! '
		+'or, you know, a promise that returns a function that returns one of those things. '
		+'any questions?'
	);
	let assignMain;
	if (isAsync) {
		assignMain = `
		this.mainProcess = await process();`;
	} else {
		assignMain = `
		this.mainProcess = process;`;
	}
	const processorName = 'MainProcessor' + processorId();
	const shim = `
	import { process } from '${urlBase}${buildId}/main.js';
	class MainProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super(options);
			this.port.onmessage = async event => {
				if (event.data !== 'init main') return;
				${assignMain}
				this.port.postMessage('main ready');
			}
		}
		process(inputs, outputs, parameters) {
			const channels = outputs[0];
			for (let i=0; i<channels[0].length; i++) {
				${processWrapper}
			}
			return true;
		}
	}
	registerProcessor('${processorName}', MainProcessor);`;
	const shimUrl = URL.createObjectURL(new Blob([shim], {type: 'application/javascript'}));
	if (audioContext && audioContext.sampleRate !== sampleRate) {
		audioContext.close();
		audioContext = undefined;
	}
	if (!audioContext) audioContext = new AudioContext({sampleRate});
	if (audioContext.sampleRate !== sampleRate)
		throw new Error(`Tried to set samplerate to ${sampleRate}, got ${audioContext.sampleRate} instead.`);
	await audioContext.suspend(); // ensure process doesn't get called before ready
	await audioContext.audioWorklet.addModule(shimUrl);
	mainNode = new AudioWorkletNode(audioContext, processorName, {
		numberOfInputs: 0,
		outputChannelCount: [2]
	});
	await new Promise(resolve => {
		const msgListener = event => {
			if (event.data !== 'main ready') return;
			mainNode.port.removeEventListener('message', msgListener);
			resolve();
		};
		mainNode.port.addEventListener('message', msgListener);
		mainNode.port.start();
		mainNode.port.postMessage('init main');
	});
	mainNode.connect(audioContext.destination);
	await audioContext.resume();
};
