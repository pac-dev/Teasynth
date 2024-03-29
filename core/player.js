/** @type {Array.<PlayingPatch>} */
const playingPatches = [];

const defaultParamSpec = {
	name: 'unnamed param?',
	min: 0,
	max: 1,
	def: 0
};

export class PlayingPatch {
	constructor({url, processorName, callbacks, audioContext, initParams={}}) {
		this.url = url;
		this.processorName = processorName;
		this.callbacks = callbacks;
		this.initParams = initParams;
		this.audioContext = audioContext;
	}
	async init() {
		await this.audioContext.audioWorklet.addModule(this.url);
		const node = new AudioWorkletNode(this.audioContext, this.processorName, {
			numberOfInputs: 0,
			outputChannelCount: [2]
		});
		this.node = node;
		node.onprocessorerror = error => {
			console.log('got to rare processor error');
			throw error;
		};
		const playResult = {};
		this.playResult = playResult;
		this.paramSpecs = [];
		const rcvHostCmd = async data => {
			const resp = {type: 'hostResp', cmdId: data.cmdId};
			if (data.cmd === 'fetchMainRelative') {
				resp.content = await this.callbacks.fetchMainRelative(data.path);
			} else if (data.cmd === 'compileFaust') {
				const ret = await this.callbacks.compileFaust(data.code, data.internalMemory);
				[resp.ui8Code, resp.dspMeta] = ret;
			} else if (data.cmd === 'defineParams') {
				this.paramSpecs = data.paramSpecs.map(d => Object.assign(
					{}, defaultParamSpec, d
				));
			} else {
				throw new Error('unknown host command: '+data.cmd);
			}
			node.port.postMessage(resp);
		}
		node.port.addEventListener('message', event => {
			if (event.data.type === 'runHostCmd') rcvHostCmd(event.data);
		});
		await new Promise(resolve => {
			const readyListener = event => {
				if (event.data.type === 'main ready' || event.data.type === 'wrong samplerate') {
					node.port.removeEventListener('message', readyListener);
					// console.log(`Changing samplerate from ${wantRate} to ${event.data.wantRate}.`)
					Object.assign(playResult, event.data);
					resolve();
				}
			};
			node.port.addEventListener('message', readyListener);
			node.port.start();
			node.port.postMessage({type: 'init main', initParams: this.initParams});
		});
	}
	postMessage(msg) { this.node.port.postMessage(msg); }
	setParam(name, val) { this.postMessage({type: 'set param', name, val}); }
	stop() {
		// this.node.disconnect();
		this.audioContext.close();
	}
}

const initContext = wantRate => {
	const audioContext = new AudioContext({sampleRate: wantRate}); // , latencyHint: 1
	if (audioContext.sampleRate !== wantRate)
		throw new Error(`Tried to set samplerate to ${wantRate}, got ${audioContext.sampleRate} instead.`);
	console.log('Base latency: '+(Math.floor(audioContext.baseLatency*1000)/1000));
	return audioContext;
};

export const createPatch = async ({url, processorName, callbacks, initParams, wantRate=44100}) => {
	let audioContext = initContext(wantRate);
	const ret = new PlayingPatch({url, processorName, callbacks, audioContext, initParams});
	await ret.init();
	if (ret.playResult.type === 'wrong samplerate') {
		audioContext.close();
		audioContext = initContext(ret.playResult.wantRate);
		ret.audioContext = audioContext;
		await ret.init();
	}
	if (ret.playResult.type !== 'main ready') throw new Error('Error adding node: '+processorName);
	ret.node.connect(audioContext.destination);
	playingPatches.push(ret);
	return ret;
};

/**
 * @param {PlayingPatch} patch 
 */
export const removePatch = (patch, cleanContext=false) => {
	patch.stop();
	playingPatches.splice(playingPatches.indexOf(patch), 1);
	// if (cleanContext && audioContext && !playingPatches.length) {
	// 	audioContext.close();
	// 	audioContext = undefined;
	// }
};
