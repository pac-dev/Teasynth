import { parse } from 'https://deno.land/std@0.118.0/flags/mod.ts';
import { loadTrack, parseParamArgs, createRenderer } from './renderlib.js';

const helpText = `
Teagen loop renderer.

Usage:
deno run -A render-loop.js [-intro X] [-loop X] [-xf X] [-p-PARAM X ...] path/to/main.js out-root
`;
const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};
const args = parse(Deno.args);
if (args._.length !== 2) helpAndExit();
const outBase = args._[1];
const inDur = args.intro ?? 6;
const loopDur = args.loop ?? 18;
const xfDur = args.xf ?? 2;

const track = await loadTrack('./'+args._[0]);
track.setParams(parseParamArgs(args));
const r = createRenderer(track);

console.log('rendering...');
const inPipe = await r.addOutput(outBase+'_intro.ogg');
await r.render(inDur);
r.fadeOut(inPipe, xfDur);
const loopPipe = await r.addOutput(outBase+'_loop.ogg');
r.fadeIn(loopPipe, xfDur);
await r.render(xfDur);
await r.removeOutput(inPipe);
await r.render(loopDur);
r.fadeOut(loopPipe, xfDur);
await r.render(xfDur);
await r.removeOutput(loopPipe);