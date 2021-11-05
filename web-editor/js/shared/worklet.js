
export const makeWorklet = (mainUrl, platformUrl, processorName) => `
	import * as mainModule from '${mainUrl}';
	import { platform } from '${platformUrl}';

	const runHostCmd = (port, data) => new Promise(resolve => {
		const cmdId = Math.random().toString(36).substring(7);
		const msgListener = event => {
			if (event.data.type !== 'hostResp' || event.data.cmdId !== cmdId) return;
			port.removeEventListener('message', msgListener);
			resolve(event.data);
		};
		port.addEventListener('message', msgListener);
		port.start();
		data.type = 'runHostCmd';
		data.cmdId = cmdId;
		port.postMessage(data);
	});

	let firstFrame, canFill = false;
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
		if (!canFill) {
			channels[0][i] = 0;
			channels[1][i] = 0;
			return;
		}
		frame2channels(firstFrame, channels, i);
		fillChannels = cruiseChannels;
	};
	
	const init = async (port, data) => {
		const wantRate = mainModule.sampleRate ?? 44100;
		if (wantRate !== sampleRate) {
			port.postMessage({type: 'wrong samplerate', wantRate});
			return;
		}
		platform.getMainRelative = async path => {
			const resp = await runHostCmd(port, {cmd: 'getMainRelative', path});
			return resp.content;
		};
		platform.compileFaust = async (code, internalMemory) => {
			return await runHostCmd(port, {cmd: 'compileFaust', code, internalMemory});
		};
		platform.initialized = true;
		const paramSpecs = [];
		for (let name of Object.keys(platform.params)) {
			const param = platform.params[name];
			paramSpecs.push({...param, name, setFn: false});
			if (name in data.initParams) {
				param.setFn(parseFloat(data.initParams[name]));
			}
		}
		await runHostCmd(port, {cmd: 'defineParams', paramSpecs});
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
		canFill = true;
		port.addEventListener('message', event => {
			if (event.data.type !== 'set param') return;
			if (!(event.data.name in platform.params)) return;
			platform.params[event.data.name].setFn(parseFloat(event.data.val));
		});
		port.postMessage({type: 'main ready'});
	};
	
	class MainProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super(options);
			this.port.onmessage = event => {
				if (event.data.type === 'init main') {
					init(this.port, event.data);
				}
			}
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