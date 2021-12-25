import { parse } from 'https://deno.land/std@0.118.0/flags/mod.ts';
import { resolve, toFileUrl } from 'https://deno.land/std/path/mod.ts';
import { existsSync } from 'https://deno.land/std/fs/mod.ts';
import { compileFaust } from './web-editor/js/shared/faustCompiler.js';

const helpText = `
Teagen renderer.

Usage:
deno run -A render-loop.js [-intro X] [-loop X] [-xf X] path/to/main.js out-root
`;

const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};

const args = parse(Deno.args);
if (args._.length !== 2) helpAndExit();
const mainPath = './'+args._[0];
const outBase = args._[1];
const inDur = args.intro ?? 6;
const loopDur = args.loop ?? 18;
const xfDur = args.xf ?? 2;
const findHostPath = () => {
	let hostDir = mainPath;
	while(hostDir.length > 2) {
		// remove last component of path
		hostDir = hostDir.replace(/\/([^\/]+)$/, '');
		if (existsSync(hostDir+'/host.js')) {
			return hostDir+'/host.js';
		}
	}
}
const hostPath = findHostPath();
if (!hostPath) throw new Error('could not find host.js');
const hostMod = await import(toFileUrl(resolve(hostPath)).href);
const mainMod = await import(toFileUrl(resolve(mainPath)).href);

hostMod.mainHost.fetchMainRelative = async path => {
	path = mainPath.replace(/\/([^\/]+)$/, '')+'/'+path;
	return await Deno.readTextFile(path);
};
hostMod.mainHost.compileFaust = async (code, internalMemory) => {
	const comp = await compileFaust(code, internalMemory);
	return { ui8Code: comp.ui8Code, dspMeta: comp.dspMeta };
};
await hostMod.mainHost.init();

console.log('rendering...');
const bufFrames = 2048;
const sr = 44100;
const buf = new Float32Array(bufFrames*2);
const buf2 = new Float32Array(bufFrames*2);
const pipes = new Set();
const xf = x => -1 * Math.pow(-0.5 * Math.cos((x + 1)*Math.PI) + 0.5, 1.772) + 1;
const copyAmp = (src, tgt, amp) => {
	for (let i=0; i<tgt.length; i++) {
		tgt[i] = src[i] * amp;
	}
};
const addPipe = async outPath => {
	const ret = Deno.run({
		cmd: ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0', outPath],
		stdin: 'piped', stderr: 'piped'
	});
	pipes.add(ret);
	return ret;
};
const removePipe = async p => {
	p.stdin.close();
	await p.status();
	p.close();
	pipes.delete(p);
};
const render = async dur => {
	for (let i=0; i<dur*sr/bufFrames; i++) {
		for (let j=0; j<bufFrames; j++) {
			[buf[j*2], buf[j*2+1]] = mainMod.process();
		}
		for (let p of pipes) {
			if (p.xf) {
				copyAmp(buf, buf2, p.xf());
				await p.stdin.write(buf2);
			} else {
				await p.stdin.write(buf);
			}
		}
	}
};
const fadeIn = (pipe, dur) => {
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
};
const fadeOut = (pipe, dur) => {
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
};

const inPipe = await addPipe(outBase+'_intro.ogg');
await render(inDur);
fadeOut(inPipe, xfDur);
const loopPipe = await addPipe(outBase+'_loop.ogg');
fadeIn(loopPipe, xfDur);
await render(xfDur);
await removePipe(inPipe);
await render(loopDur);
fadeOut(loopPipe, xfDur);
await render(xfDur);
await removePipe(loopPipe);