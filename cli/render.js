import { path, exists } from './deps.js';
import { compileFaust } from '../core/faustCompiler.js';

const findHostPath = async startPath => {
	while(startPath.length > 1) {
		startPath = path.dirname(startPath);
		if (await exists(path.join(startPath, 'host.js'))) {
			return path.join(startPath, 'host.js');
		}
	}
};

const importFile = async (filePath, bustCache) => {
	filePath = path.toFileUrl(path.resolve(filePath)).href;
	if (bustCache) filePath +='?id='+(Math.random().toString(36).substring(7));
	return await import(filePath);
};

/**
 * Load a teasynth patch. Note that you can only have a single patch loaded at a
 * time. Once you switch patches, you can't go back to the previous one. Using
 * multiple threads or processes is currenly the only way around this.
 */
export const loadPatch = async mainPath => {
	const hostPath = await findHostPath(mainPath);
	if (!hostPath) throw new Error('could not find host.js');
	const hostMod = await importFile(hostPath);
	const mainHost = hostMod.mainHost;
	const mainMod = await importFile(mainPath, true);
	mainHost.fetchMainRelative = async fetchPath => {
		fetchPath = path.join(mainPath, '..', fetchPath);
		return await Deno.readTextFile(fetchPath);
	};
	mainHost.compileFaust = async (code, internalMemory) => {
		const comp = await compileFaust(code, internalMemory);
		return { ui8Code: comp.ui8Code, dspMeta: comp.dspMeta };
	};
	let process = mainMod.process;
	if (mainMod.instantiate) {
		process = await mainMod.instantiate();
	}
	await mainHost.init();
	return {
		setParams(vals) {
			for (let [name, val] of Object.entries(vals)) {
				if (!(name in mainHost.params)) throw new Error('No param '+name);
				mainHost.params[name].setFn(parseFloat(val));
			}
		},
		host: mainHost,
		process
	};
};

export const parseParamArgs = args => {
	const ret = {};
	for (let [name, val] of Object.entries(args)) {
		if (!name.startsWith('p-')) continue;
		ret[name.slice(2)] = val;
	}
	return ret;
};

const copyAmp = (src, tgt, amp) => {
	for (let i=0; i<tgt.length; i++) {
		tgt[i] = src[i] * amp;
	}
};

export const createRenderer = (patch) => {
	const bufFrames = 2048;
	const sr = 44100;
	const buf = new Float32Array(bufFrames*2);
	const buf2 = new Float32Array(bufFrames*2);
	const bufView = new Uint8Array(buf.buffer);
	const bufView2 = new Uint8Array(buf2.buffer);
	const pipes = new Set();
	const xf = x => -1 * Math.pow(-0.5 * Math.cos((x + 1)*Math.PI) + 0.5, 1.772) + 1;
	return {
		async addOutput(outPath) {
			const ext = outPath.split('.').at(-1);
			const cmd = ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0'];
			if (ext === 'mp3') cmd.push('-b:a', '192k');
			cmd.push(outPath);
			const ret = Deno.run({ cmd, stdin: 'piped', stderr: 'piped' });
			pipes.add(ret);
			return ret;
		},
		async removeOutput(p) {
			p.stdin.close();
			await p.status();
			p.close();
			pipes.delete(p);
		},
		async render(dur) {
			for (let i=0; i<dur*sr/bufFrames; i++) {
				for (let j=0; j<bufFrames; j++) {
					[buf[j*2], buf[j*2+1]] = patch.process();
				}
				for (let p of pipes) {
					if (p.xf) {
						copyAmp(buf, buf2, p.xf());
						await p.stdin.write(bufView2);
					} else {
						await p.stdin.write(bufView);
					}
				}
				if (patch.host.wantInterrupt) {
					delete patch.host.wantInterrupt;
					break;
				}
			}
		},
		fadeIn(pipe, dur) {
			dur *= 1.01;
			pipe.xfPos = 0;
			pipe.xf = () => {
				const ret = xf(pipe.xfPos);
				pipe.xfPos += bufFrames/(sr*dur);
				if (pipe.xfPos > 1) {
					delete pipe.xf;
				}
				return ret;
			}
		},
		fadeOut(pipe, dur) {
			dur *= 1.01;
			pipe.xfPos = 1;
			pipe.xf = () => {
				const ret = xf(pipe.xfPos);
				pipe.xfPos -= bufFrames/(sr*dur);
				if (pipe.xfPos < 0) {
					delete pipe.xf;
				}
				return ret;
			}
		},
	}
};