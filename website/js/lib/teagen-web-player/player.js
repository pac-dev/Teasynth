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
/** @type {AudioContext} */
let audioContext;
/** @type {AudioWorkletNode} */
let mainNode;
const processorId = (() => {
	let count = 1;
	return () => ++count;
})();

/** @param {Project} proj */
export const play = async proj => {
	blobUrls.forEach(url => URL.revokeObjectURL(url));
	blobUrls.length = 0;
	let mainUrl;
	const mapObj = {};
	for (let module of proj.getFiles()) {
		const url = URL.createObjectURL(new Blob([module.content], {type: 'application/javascript'}));
		blobUrls.push(url);
		if (module.path == 'main.js') mainUrl = url;
		mapObj['/'+module.path] = url;
	}
	const scopes = {};
	for (let url of blobUrls) {
		scopes[url] = Object.assign({}, mapObj);
	}
	const mapEle = document.createElement('script');
	mapEle.type = 'importmap';
	mapEle.textContent = JSON.stringify({scopes});
	document.body.append(mapEle);

	if (!mainUrl) throw new Error('Could not find main.js in the project.');
	const preRun = await import(mainUrl);
	const sampleRate = preRun.sampleRate ?? 44100;
	if (!preRun.process) throw new Error('main.js must export a "process" function!');
	const preOut = preRun.process(0);
	let processWrapper;
	if (typeof preOut === 'number') {
		processWrapper = `
		const s = process(this.samplePos++);
		channels[0][i] = s;
		channels[1][i] = s;`;
	} else if (Array.isArray(preOut) && preOut.length === 2) {
		processWrapper = `
		const [s1, s2] = process(this.samplePos++);
		channels[0][i] = s1;
		channels[1][i] = s2;`;
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
	stop();
	if (audioContext && audioContext.sampleRate !== sampleRate) {
		audioContext.close();
		audioContext = undefined;
	}
	if (!audioContext) audioContext = new AudioContext({sampleRate});
	if (audioContext.sampleRate !== sampleRate)
		throw new Error(`Tried to set samplerate to ${sampleRate}, got ${audioContext.sampleRate} instead.`);
	await audioContext.audioWorklet.addModule(shimUrl);
	mainNode = new AudioWorkletNode(audioContext, processorName, {
		numberOfInputs: 0,
		outputChannelCount: [2]
	});
	mainNode.connect(audioContext.destination);
};

export const stop = async () => {
	if (!audioContext) return;
	if (!mainNode) return;
	mainNode.disconnect();
	mainNode = undefined;
};
