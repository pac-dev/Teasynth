import { JSZip } from './lib/jszipModule.js';
import { Project } from './Project.js';

/** @param {Project} proj */
export const proj2zip = async proj => {
	const zip = new JSZip();
	proj.getFiles().forEach(f => zip.file(f.path, f.content))
	return await zip.generateAsync({type:'blob'});
}

/** @param {File} file */
export const zip2proj = async file => {
	const zip = await JSZip.loadAsync(file);
	const proj = new Project(file.name.substr(0, file.name.lastIndexOf('.')));
	const entries = [];
	zip.forEach((path, obj) => entries.push({path, obj}));
	for (let {path, obj} of entries) {
		const content = await obj.async('string');
		proj.addFile(path, content);
	}
	return proj;
}

const blobUrls = [];
/** @type {HTMLIFrameElement} */
let playFrame;
/** @type {AudioContext} */
let audioContext;
/** @type {AudioWorkletNode} */
let mainNode;
const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

export const stop = async () => {
	if (mainNode) {
		mainNode.disconnect();
		mainNode = undefined;
	}
	if (audioContext) {
		audioContext.close();
		audioContext = undefined;
	}
	if (playFrame) {
		playFrame.remove();
		playFrame = undefined;
	}
};

const runInFrame = (type, content) => {
	const ele = playFrame.contentDocument.createElement('script');
	ele.type = type;
	ele.textContent = content;
	playFrame.contentDocument.body.append(ele);
};

/** @param {Project} proj */
export const play = async proj => {
	stop();
	playFrame = document.createElement('iframe');
	playFrame.style.display = 'none';
	document.body.appendChild(playFrame);
	console.log(playFrame.contentDocument.readyState);
	await new Promise((resolve, reject) => {
		if (playFrame.contentDocument.readyState == 'complete')
			resolve();
		else
			playFrame.onload = resolve;
	});
	console.log(playFrame.contentDocument.readyState);
	blobUrls.forEach(url => URL.revokeObjectURL(url));
	blobUrls.length = 0;
	let mainUrl;
	const mapObj = {};
	for (let module of proj.getFiles()) {
		const url = URL.createObjectURL(new Blob([module.content], {type: 'application/javascript'}));
		blobUrls.push(url);
		if (module.path == 'main.js') mainUrl = url;
		mapObj[module.path] = url;
	}
	if (!mainUrl) throw new Error('Could not find main.js in the project.');
	const scopes = {};
	for (let url of blobUrls) {
		scopes[url] = Object.assign({}, mapObj); // why am i cloning it every time?
	}
	runInFrame('importmap', JSON.stringify({
		imports: Object.assign({}, mapObj), // ??? // also i don't think you need "imports"
		scopes
	}));
	const messageData = await new Promise((resolve, reject) => {
		window.addEventListener('message', event => {
			resolve(event.data);
		}, {once : true});
		runInFrame('module', `
		(async () => {
			let preRunModule;
			try {
				console.log('prerun 1');
				preRunModule = await import('${mainUrl}');
				console.log('prerun 2');
			} catch (e) {
				window.parent.postMessage({
					type: 'preRunComplete',
					success: false,
					errObj: e
				}, '*');
				return;
			}
			if (!preRunModule.process) window.parent.postMessage({
				type: 'preRunComplete',
				success: false,
				info: 'main.js must export a "process" function!'
			}, '*');
			const preOut = preRunModule.process(0);
			window.parent.postMessage({
				type: 'preRunComplete',
				success: true,
				preOut,
				sampleRate: preRunModule.sampleRate
			}, '*');
		})();
		`);
	});
	if (messageData.type !== 'preRunComplete') {
		throw new Error('Got wrong message from play frame!');
	} else if (!messageData.success && messageData.errObj) {
		throw messageData.errObj;
	} else if (!messageData.success) {
		throw new Error(messageData.info);
	};
	const sampleRate = messageData.sampleRate ?? 44100;
	const preOut = messageData.preOut;
	let processWrapper;
	if (typeof preOut === 'number') {
		processWrapper = `
		const s = process(this.samplePos++);
		channels[0][i] = s;
		channels[1][i] = s;`;
		console.log('preRun returned mono signal.');
	} else if (Array.isArray(preOut) && preOut.length === 2) {
		processWrapper = `
		const [s1, s2] = process(this.samplePos++);
		channels[0][i] = s1;
		channels[1][i] = s2;`;
		console.log('preRun returned stereo signal.');
	} else throw new Error('process must return a number or an array of two numbers!');
	const processorName = 'MainProcessor' + processorId();
	const shim = `
	import { process } from '${mainUrl}';
	class MainProcessor extends AudioWorkletProcessor {
		constructor(options) {
			super(options);
			this.samplePos = 0;
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
	runInFrame('application/javascript', `
	(async () => {
		const audioContext = new AudioContext({sampleRate: ${sampleRate}});
		if (audioContext.sampleRate !== ${sampleRate})
			throw new Error('Tried to set samplerate to ${sampleRate}, got '+audioContext.sampleRate+' instead.');
		await audioContext.audioWorklet.addModule('${shimUrl}');
		const mainNode = new AudioWorkletNode(audioContext, '${processorName}', {
			numberOfInputs: 0,
			outputChannelCount: [2]
		});
		mainNode.connect(audioContext.destination);
	})();
	`);
};
