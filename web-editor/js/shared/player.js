
/** @type {AudioContext} */
let audioContext;
const playingNodes = [];

/**
 * @param {AudioWorkletNode} node 
 */
export const remove = node => {
	node.disconnect();
	playingNodes.splice(playingNodes.indexOf(node), 1);
	if (audioContext && !playingNodes.length) {
		audioContext.close();
		audioContext = undefined;
	}
};

const initContext = wantRate => {
	audioContext = new AudioContext({sampleRate: wantRate}); // , latencyHint: 1
	if (audioContext.sampleRate !== wantRate)
		throw new Error(`Tried to set samplerate to ${wantRate}, got ${audioContext.sampleRate} instead.`);
	console.log('Base latency: '+(Math.floor(audioContext.baseLatency*1000)/1000));
};

const initNode = async (url, processorName, callbacks) => {
	await audioContext.audioWorklet.addModule(url);
	const node = new AudioWorkletNode(audioContext, processorName, {
		numberOfInputs: 0,
		outputChannelCount: [2]
	});
	const runHostCmd = async data => {
		const resp = {type: 'hostResp', cmdId: data.cmdId};
		if (data.cmd === 'getMainRelative') {
			resp.content = callbacks.getMainRelative(data.path);
		} else if (data.cmd === 'compileFaust') {
			const ret = await callbacks.compileFaust(data.code, data.internalMemory);
			[resp.ui8Code, resp.dspMeta] = ret;
		} else {
			throw new Error('unknown host command: '+data.cmd);
		}
		node.port.postMessage(resp);
	}
	node.port.addEventListener('message', event => {
		if (event.data.type === 'runHostCmd') runHostCmd(event.data);
	});
	return await new Promise(resolve => {
		const readyListener = event => {
			if (event.data.type === 'main ready' || event.data.type === 'wrong samplerate') {
				node.port.removeEventListener('message', readyListener);
				// console.log(`Changing samplerate from ${wantRate} to ${event.data.wantRate}.`)
				resolve([node, event.data]);
			}
		};
		node.port.addEventListener('message', readyListener);
		node.port.start();
		node.port.postMessage({type: 'init main'});
	});
};

export const add = async (url, processorName, callbacks, wantRate=44100) => {
	if (!audioContext) initContext(wantRate);
	let [node, playResult] = await initNode(url, processorName, callbacks);
	if (playResult.type === 'wrong samplerate') {
		remove(node);
		if (audioContext) throw new Error('Nodes require conflicting sample rates: '+processorName);
		initContext(playResult.wantRate);
		[node, playResult] = await initNode(url, processorName, callbacks);
	}
	if (playResult.type !== 'main ready') throw new Error('Error adding node: '+processorName);
	node.connect(audioContext.destination);
	playingNodes.push(node);
	return node;
};