
export const makeWorklet = (mainUrl, urlBase, processorName) => `
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