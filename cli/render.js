import { resolve, toFileUrl, existsSync } from './deps.js';
import { compileFaust } from '../core/faustCompiler.js';

const findHostPath = startPath => {
	while(startPath.length > 2) {
		// remove last component of path
		startPath = startPath.replace(/\/([^\/]+)$/, '');
		if (existsSync(startPath+'/host.js')) {
			return startPath+'/host.js';
		}
	}
};

export const loadTrack = async mainPath => {
	const hostPath = findHostPath(mainPath);
	if (!hostPath) throw new Error('could not find host.js');
	const hostMod = await import(toFileUrl(resolve(hostPath)).href);
	const mainMod = await import(toFileUrl(resolve(mainPath)).href+'?id='+(Math.random().toString(36).substring(7)));
	hostMod.mainHost.fetchMainRelative = async path => {
		path = mainPath.replace(/\/([^\/]+)$/, '')+'/'+path;
		return await Deno.readTextFile(path);
	};
	hostMod.mainHost.compileFaust = async (code, internalMemory) => {
		const comp = await compileFaust(code, internalMemory);
		return { ui8Code: comp.ui8Code, dspMeta: comp.dspMeta };
	};
	let process = mainMod.process;
	if (mainMod.instantiate) {
		process = await mainMod.instantiate();
	}
	await hostMod.mainHost.init();
	return {
		setParams(vals) {
			for (let [name, val] of Object.entries(vals)) {
				if (!(name in hostMod.mainHost.params)) throw new Error('No param '+name);
				hostMod.mainHost.params[name].setFn(parseFloat(val));
			}
		},
		host: hostMod.mainHost,
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

export const createRenderer = track => {
	const bufFrames = 2048;
	const sr = 44100;
	const buf = new Float32Array(bufFrames*2);
	const buf2 = new Float32Array(bufFrames*2);
	const pipes = new Set();
	const xf = x => -1 * Math.pow(-0.5 * Math.cos((x + 1)*Math.PI) + 0.5, 1.772) + 1;
	return {
		async addOutput(outPath) {
			const ret = Deno.run({
				cmd: ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0', outPath],
				stdin: 'piped', stderr: 'piped'
			});
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
					[buf[j*2], buf[j*2+1]] = track.process();
				}
				for (let p of pipes) {
					if (p.xf) {
						copyAmp(buf, buf2, p.xf());
						await p.stdin.write(buf2);
					} else {
						await p.stdin.write(buf);
					}
				}
				if (track.host.wantInterrupt) {
					delete track.host.wantInterrupt;
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