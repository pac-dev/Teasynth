import { Project, ProjFile } from './Project.js';
import { guest } from '../platform.js';
import { compileFaust } from './faustCompiler.js';

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

/**
 * @param {Project} proj
 * @param {ProjFile} main
 */
export const play = async (proj, main) => {
	console.log('playing '+main.path);
	if (!service) throw new Error('Service worker not ready.');
	await stop();
	buildId = Math.random().toString(36).substring(7);
	console.log('new build id: '+buildId);
	const files = Object.fromEntries([...proj.files].map(f => [
		buildId+'/'+f.path, f.content
	]));
	const mainUrl = `${urlBase}${buildId}/${main.path}`;
	await serviceCommand({ type: 'addBuild', buildId, files});

	guest.port = undefined;
	const preRun = await import(mainUrl);
	const preChannel = new MessageChannel();
	guest.port = preChannel.port1;
	initHostPort(proj, main, preChannel.port2);
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
	import { process } from '${mainUrl}';
	import { guest } from '${urlBase}platform.js';
	class MainProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super(options);
			this.port.onmessage = async event => {
				if (event.data.type === 'init main') {
					${assignMain}
					this.port.postMessage({type: 'main ready'});
				}
			}
			guest.port = this.port;
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
	initHostPort(proj, main, mainNode.port);
	await new Promise(resolve => {
		const msgListener = event => {
			if (event.data.type !== 'main ready') return;
			mainNode.port.removeEventListener('message', msgListener);
			resolve();
		};
		mainNode.port.addEventListener('message', msgListener);
		mainNode.port.start();
		mainNode.port.postMessage({type: 'init main'});
	});
	mainNode.connect(audioContext.destination);
	await audioContext.resume();
};

/**
 * @param {Project} proj
 * @param {ProjFile} main
 * @param {MessagePort} port
 */
const initHostPort = (proj, main, port) => {
	const runHostCmd = async data => {
		const resp = {type: 'hostResp', cmdId: data.cmdId};
		if (data.cmd === 'getMainRelative') {
			resp.content = main.relativeFile(data.path).content;
		} else if (data.cmd === 'compileFaust') {
			const comp = await compileFaust(data.code, data.internalMemory);
			resp.ui8Code = comp.ui8Code;
			resp.dspMeta = comp.dspMeta;
		} else {
			throw new Error('unknown host command: '+data.cmd);
		}
		port.postMessage(resp);
	}
	const msgListener = event => {
		if (event.data.type === 'runHostCmd') runHostCmd(event.data);
	};
	port.addEventListener('message', msgListener);
	port.start();
};