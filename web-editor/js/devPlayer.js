import { Project, ProjFile } from './shared/Project.js';
import { compileFaust } from './shared/faustCompiler.js';
import { makeWorklet } from './shared/worklet.js';
import { PlayingTrack, createTrack, removeTrack } from './shared/player.js';

/** @type {ServiceWorker} */
let service;
/** @type {PlayingTrack} */
export let mainTrack;
export let knownParams = [];
export let lastUrl, lastPlayMain, lastName;

const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

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

export const devStop = async () => {
	if (!service) throw new Error('Service worker not ready.');
	if (!mainTrack) return;
	removeTrack(mainTrack, false); // Persist the context to test instancing
	mainTrack = undefined;
};

const playUrl = async (main, shimUrl, processorName) => {
	const callbacks = {
		getMainRelative(path) {
			return main.relativeFile(path).content;
		},
		async compileFaust(code, internalMemory) {
			const comp = await compileFaust(code, internalMemory);
			return [comp.ui8Code, comp.dspMeta];
		}
	};
	const initParams = Object.fromEntries(knownParams.map(p => [p.name, p.val]));
	mainTrack = await createTrack({url: shimUrl, processorName, callbacks, initParams});
	for (let param of mainTrack.paramSpecs) {
		const existingIdx = knownParams.findIndex(p => p.name === param.name);
		if (existingIdx === -1) {
			param.val = param.def;
			knownParams.push(param);
		} else {
			Object.assign(knownParams[existingIdx], param);
		}
	}
};

/**
 * @param {Project} proj
 * @param {ProjFile} main
 */
export const devPlay = async (proj, main) => {
	console.log('Playing '+main.path);
	if (!service) throw new Error('Service worker not ready.');
	await devStop();
	if (buildId) await serviceCommand({type: 'removeBuild', buildId});
	buildId = Math.random().toString(36).substring(7);
	const files = Object.fromEntries([...proj.files].map(f => [
		buildId+'/'+f.path, f.content
	]));
	const mainUrl = `${urlBase}${buildId}/${main.path}`;
	const platformUrl = `${urlBase}${buildId}/platform.js`;
	await serviceCommand({ type: 'addBuild', buildId, files});
	const processorName = 'MainProcessor' + processorId();
	const shim = makeWorklet(mainUrl, platformUrl, processorName);
	const shimUrl = URL.createObjectURL(new Blob([shim], {type: 'application/javascript'}));
	await playUrl(main, shimUrl, processorName);
	lastPlayMain = main;
	lastUrl = shimUrl;
	lastName = processorName;
};

export const devReplay = async () => {
	console.log('Relaying '+lastPlayMain.path);
	await playUrl(lastPlayMain, lastUrl, lastName);
};