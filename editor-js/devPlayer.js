import { Project, ProjFile } from '../core/project.js';
import { compileFaust } from '../core/faustCompiler.js';
import { makeWorklet } from '../core/worklet.js';
import { PlayingTrack, createTrack, removeTrack } from '../core/player.js';

/** @type {ServiceWorker} */
let service;

/**
 * @typedef {Object} DevTrack
 * @property {string} name
 * @property {string} buildId
 * @property {string} shimUrl
 * @property {string} processorName
 * @property {PlayingTrack} track
 * @property {Array} params
 * @property {ProjFile} main
 * @property {('proposed'|'playing'|'loading'|'stopped')} status
 */

/** @type {Array.<DevTrack>} */
export const devTracks = [];
window.devTracks = devTracks;

const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

let urlBase;

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

export const devStop = async dt => {
	if (!service) throw new Error('Service worker not ready.');
	if (dt.buildId) {
		await serviceCommand({type: 'removeBuild', buildId: dt.buildId});
		dt.buildId = undefined;
	}
	if (dt.track) {
		removeTrack(dt.track, false);
		dt.track = undefined;
	}
	dt.status = 'stopped';
};

export const parseParamStr = (str) => Function(`"use strict"; return parseFloat(${str})`)();

const playUrl = async dt => {
	const callbacks = {
		fetchMainRelative(path) {
			return dt.main.relativeFile(path).content;
		},
		async compileFaust(code, internalMemory) {
			const comp = await compileFaust(code, internalMemory);
			return [comp.ui8Code, comp.dspMeta];
		}
	};
	const initParams = Object.fromEntries(dt.params.map(p => [p.name, p.val]));
	dt.track = await createTrack({url: dt.shimUrl, processorName: dt.processorName, callbacks, initParams});
	const oldParams = dt.params;
	// old/init params are kept by the track unless they are out of bounds
	// note that the type (text or number/slider) may have changed
	dt.params = dt.track.paramSpecs.map(spec => {
		let val = spec.def;
		let valStr = spec.defStr;
		const old = oldParams.find(p => p.name === spec.name);
		if (old && old.val >= spec.min && old.val <= spec.max) val = old.val;
		if (old && spec.defStr && val === old.val) {
			if (old.valStr) valStr = old.valStr;
			else valStr = val.toString();
		}
		return { name: spec.name, val, valStr, min: spec.min, max: spec.max };
	});
	dt.status = 'playing';
};

/**
 * @param {Project} proj
 * @param {ProjFile} main
 */
export const devPlay = async (proj, main) => {
	console.log('Playing '+main.path);
	if (!service) throw new Error('Service worker not ready.');
	const name = main.parent.path;
	let dt = devTracks.find(t => t.name === name);
	// It seems impossible to distinguish between error state and loading state,
	// so let's just call stop and clean up any existing resources.
	if (dt) {
		await devStop(dt);
	} else {
		dt = { name, main, params: [], status: 'loading' };
		devTracks.push(dt);
	}
	dt.buildId = 'build'+Math.random().toString(36).substring(7);
	const files = Object.fromEntries([...proj.files].map(f => [
		dt.buildId+'/'+f.path, f.content
	]));
	const mainUrl = `${urlBase}${dt.buildId}/${main.path}`;
	const hostUrl = `${urlBase}${dt.buildId}/host.js`;
	await serviceCommand({ type: 'addBuild', buildId: dt.buildId, files});
	dt.processorName = 'MainProcessor' + processorId();
	const shim = makeWorklet(mainUrl, hostUrl, dt.processorName);
	dt.shimUrl = URL.createObjectURL(new Blob([shim], {type: 'application/javascript'}));
	await playUrl(dt);
};
