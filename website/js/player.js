import { Project, ProjFile } from './Project.js';
import { compileFaust } from './faustCompiler.js';

/** @type {ServiceWorker} */
let service;
/** @type {AudioContext} */
let audioContext;
/** @type {AudioWorkletNode} */
let mainNode;
let buildId, urlBase, firstBuild = true;

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
	if (buildId) await serviceCommand({type: 'removeBuild', buildId});
	buildId = undefined;
};

let wantRate = 44100;

/**
 * @param {Project} proj
 * @param {ProjFile} main
 */
export const play = async (proj, main) => {
	console.log('Playing '+main.path);
	if (!service) throw new Error('Service worker not ready.');
	await stop();
	buildId = Math.random().toString(36).substring(7);
	const files = Object.fromEntries([...proj.files].map(f => [
		buildId+'/'+f.path, f.content
	]));
	const mainUrl = `${urlBase}${buildId}/${main.path}`;
	await serviceCommand({ type: 'addBuild', buildId, files});
	const processorName = 'MainProcessor' + processorId();
	const shim = `
	import * as mainModule from '${mainUrl}';
	import { guest } from '${urlBase}platform.js';

	let firstFrame;
	let processFrame = () => {
		throw new Error('i suck, ep.1');
	};
	let frame2channels = (frame, channels, i) => {
		throw new Error('i suck, ep.2');
	};
	let cruiseChannels = (channels, i) => {
		frame2channels(processFrame(), channels, i);
	};
	let fillChannels = (channels, i) => {
		frame2channels(firstFrame, channels, i);
		fillChannels = cruiseChannels;
	};
	
	const init = async port => {
		const wantRate = mainModule.sampleRate ?? 44100;
		if (wantRate !== sampleRate) {
			port.postMessage({type: 'wrong samplerate', wantRate});
			return;
		}
		if (!mainModule.process) throw new Error('main.js must export a "process" function!');
		processFrame = mainModule.process;
		firstFrame = await processFrame();
		if (typeof firstFrame === 'function') {
			processFrame = firstFrame;
			firstFrame = processFrame();
		}
		if (typeof firstFrame === 'number') {
			frame2channels = (frame, channels, i) => {
				channels[0][i] = frame;
				channels[1][i] = frame;
			}
		} else if (firstFrame.length === 1) {
			frame2channels = (frame, channels, i) => {
				channels[0][i] = frame[0];
				channels[1][i] = frame[0];
			}
		} else if (firstFrame.length === 2) {
			frame2channels = (frame, channels, i) => {
				channels[0][i] = frame[0];
				channels[1][i] = frame[1];
			}
		} else throw new Error('process returned '+firstFrame+' ('+(typeof firstFrame)+')! '
			+'It should return a number or an array of one or two numbers! '
			+'or, you know, a promise that returns a function that returns one of those things. '
			+'any questions?'
		);
		port.postMessage({type: 'main ready'});
	};
	
	class MainProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super(options);
			this.port.onmessage = event => {
				if (event.data.type === 'init main') {
					init(this.port);
				}
			}
			guest.port = this.port;
		}
		process(inputs, outputs, parameters) {
			const channels = outputs[0];
			for (let i=0; i<channels[0].length; i++) {
				fillChannels(channels, i);
			}
			return true;
		}
	}
	registerProcessor('${processorName}', MainProcessor);`;
	const shimUrl = URL.createObjectURL(new Blob([shim], {type: 'application/javascript'}));
	if (audioContext && audioContext.sampleRate !== wantRate) {
		audioContext.close();
		audioContext = undefined;
	}
	if (!audioContext) audioContext = new AudioContext({sampleRate: wantRate}); // , latencyHint: 1
	if (audioContext.sampleRate !== wantRate)
		throw new Error(`Tried to set samplerate to ${wantRate}, got ${audioContext.sampleRate} instead.`);
	if (firstBuild) console.log('Base latency: '+(Math.floor(audioContext.baseLatency*1000)/1000));
	await audioContext.suspend(); // ensure process doesn't get called before ready
	await audioContext.audioWorklet.addModule(shimUrl);
	mainNode = new AudioWorkletNode(audioContext, processorName, {
		numberOfInputs: 0,
		outputChannelCount: [2]
	});
	initHostPort(main, mainNode.port);
	const success = await new Promise(resolve => {
		const msgListener = event => {
			if (event.data.type === 'main ready') {
				mainNode.port.removeEventListener('message', msgListener);
				resolve(true);
			} else if (event.data.type === 'wrong samplerate') {
				console.log(`Changing samplerate from ${wantRate} to ${event.data.wantRate}.`)
				wantRate = event.data.wantRate;
				mainNode.port.removeEventListener('message', msgListener);
				resolve(false);
			}
		};
		mainNode.port.addEventListener('message', msgListener);
		mainNode.port.start();
		mainNode.port.postMessage({type: 'init main'});
	});
	if (!success) {
		return play(proj, main); // risky line of the day
	}
	mainNode.connect(audioContext.destination);
	await audioContext.resume();
	firstBuild = false;
};

/**
 * @param {ProjFile} main
 * @param {MessagePort} port
 */
const initHostPort = (main, port) => {
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