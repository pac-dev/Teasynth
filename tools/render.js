import { parse } from 'https://deno.land/std@0.118.0/flags/mod.ts';
import { loadTrack, parseParamArgs, createRenderer } from './renderlib.js';

const helpText = `
Teasynth renderer.

Usage:
deno run -A render.js [-t DURATION] [-p-PARAM X ...] path/to/main.js out.wav
`;
const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};
const args = parse(Deno.args);
if (args._.length !== 2) helpAndExit();
const dur = args.t ?? 10;
const track = await loadTrack('./'+args._[0]);
track.setParams(parseParamArgs(args));
const r = createRenderer(track);

console.log('rendering...');
const pipe = await r.addOutput(args._[1]);
await r.render(dur);
await r.removeOutput(pipe);