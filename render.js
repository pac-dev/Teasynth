import { parse } from 'https://deno.land/std@0.118.0/flags/mod.ts';
import { resolve, toFileUrl } from 'https://deno.land/std/path/mod.ts';
import { existsSync } from 'https://deno.land/std/fs/mod.ts';
import { compileFaust } from './web-editor/js/shared/faustCompiler.js';

const helpText = `
Teagen renderer.

Usage:
deno run -A render.js [-t DURATION] path/to/main.js out.wav
`;

const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};

const args = parse(Deno.args);
if (args._.length !== 2) helpAndExit();
const mainPath = './'+args._[0];
const outPath = args._[1];
const dur = args.t ?? 10;
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

const bufFrames = 2048;
const buf = new Float32Array(bufFrames*2);
const p = Deno.run({
	cmd: ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0', outPath],
	stdin: 'piped'
});
console.log('rendering...');
for (let i=0; i<dur*44100/bufFrames; i++) {
	for (let j=0; j<bufFrames; j++) {
		[buf[j*2], buf[j*2+1]] = mainMod.process();
	}
	await p.stdin.write(buf);
}
p.stdin.close();
await p.status();
p.close();