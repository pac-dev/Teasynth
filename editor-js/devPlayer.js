import { compileFaust } from '../core/faustCompiler.js';
import { makeWorklet } from '../core/worklet.js';
import { createPatch, removePatch } from '../core/player.js';

/** @type {ServiceWorker} */
let service;
let urlBase;

/** @type {Array.<DevPatch>} */
export const devPatches = [];
window.devPatches = devPatches;

export const parseParamStr = (str) => Function(`"use strict"; return parseFloat(${str})`)();

const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

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

export class DevPatch {
	/**
	 * @param {import('../core/project.js').Project} proj 
	 * @param {import('../core/project.js').ProjFile} main 
	 */
	constructor(proj, main) {
		this.proj = proj;
		this.main = main;
		this.name = main.parent.path.replace(/^(patches\/)/, '');
		/** @type {('playing'|'loading'|'stopped'|'linked')} */
		this.status = 'stopped';
		this.params = [];
		devPatches.push(this);
	}
	async pushBuild() {
		if (!service) throw new Error('Service worker not ready.');
		await this.stop();
		this.buildId = 'build'+Math.random().toString(36).substring(7);
		const files = Object.fromEntries([...this.proj.files].map(f => [
			this.buildId+'/'+f.path, f.content
		]));
		this.mainUrl = `${urlBase}${this.buildId}/${this.main.path}`;
		this.hostUrl = `${urlBase}${this.buildId}/host.js`;
		await serviceCommand({ type: 'addBuild', buildId: this.buildId, files});
	}
	async play() {
		await this.pushBuild();
		const processorName = 'MainProcessor' + processorId();
		const shim = makeWorklet(this.mainUrl, this.hostUrl, processorName);
		const shimUrl = URL.createObjectURL(new Blob([shim], {type: 'application/javascript'}));
		const self = this;
		const callbacks = {
			fetchMainRelative(path) {
				return self.main.relativeFile(path).content;
			},
			async compileFaust(code, internalMemory) {
				const comp = await compileFaust(code, internalMemory);
				return [comp.ui8Code, comp.dspMeta];
			}
		};
		const initParams = Object.fromEntries(this.params.map(p => 
			[p.name, typeof p.val === 'number' ? p.val : parseParamStr(p.val)]
		));
		this.patch = await createPatch({url: shimUrl, processorName, callbacks, initParams});
		const oldParams = this.params;
		// old/init params are kept by the patch unless they are out of bounds
		// note that the type (text or number/slider) may have changed
		this.params = this.patch.paramSpecs.map(spec => {
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
		this.status = 'playing';
	}
	async scanParams() {
		await this.stop();
		await this.pushBuild();
		this.params = [];
		const hostMod = await import(this.hostUrl);
		const mainMod = await import(this.mainUrl);
		if (mainMod.instantiate) await mainMod.instantiate();
		await hostMod.mainHost.events.trigger('got host');
		for (let [name, spec] of Object.entries(hostMod.mainHost.params)) {
			this.params.push({...spec, name, val: spec.def, valStr: spec.defStr, setFn: false});
		}
	}
	async stop() {
		if (!service) throw new Error('Service worker not ready.');
		if (this.buildId) {
			await serviceCommand({type: 'removeBuild', buildId: this.buildId});
			this.buildId = undefined;
		}
		if (this.patch) {
			removePatch(this.patch, false);
			this.patch = undefined;
		}
		this.status = 'stopped';
	}
}
