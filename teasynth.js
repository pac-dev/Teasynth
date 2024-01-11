import { parse, bold, cyan, path } from './cli/deps.js';
import { loadTrack, parseParamArgs, createRenderer } from './cli/render.js';
import { build } from './cli/build.js';
import { readConfig, serveEditor, generateEditor } from './cli/editor.js';
import { playUpToStamp, macroEvents } from './core/macro.js';
import { MultiRenderer, subprocess } from './cli/multirender.js';

const cmd = txt => cyan(bold(txt));

const helpText = `
Teasynth command line.
If installed, invoke with: ${cmd('teasynth')}
Otherwise, use: ${cmd('deno run -A --unstable teasynth.js')}

Subcommands:

  ${cmd('render')}: Render a track to an audio file.
    Usage: ${cmd('teasynth render MAINFILE OUTFILE [-t DURATION] [-p-PARAM X ...]')}
  ${cmd('build')}: Build tracks from a project into js+wasm bundles.
    Usage: ${cmd('teasynth build PROJDIR OUTDIR [--track NAME]')}
  ${cmd('serve-editor')}: Serve the Teasynth web editor locally.
    Usage: ${cmd('teasynth serve-editor [--config FILE]')}
  ${cmd('generate-editor')}: Generate the Teasynth editor static website for deployment.
    Usage: ${cmd('teasynth generate-editor OUTDIR [--config FILE] [-y]')}
  ${cmd('macro')}: Render a macro file to an audio file.
    Usage: ${cmd('teasynth macro PROJDIR MACFILE OUTFILE')}
`;

const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};

const commandActions = {
	async render(args) {
		if (args._.length !== 3) helpAndExit();
		const dur = args.t ?? 10;
		const track = await loadTrack('./' + args._[1]);
		track.setParams(parseParamArgs(args));
		const r = createRenderer(track);
		console.log('rendering...');
		const pipe = await r.addOutput(args._[2]);
		await r.render(dur);
		await r.removeOutput(pipe);
	},
	async build(args) {
		if (args._.length !== 3) helpAndExit();
		const outDir = args._[2] + '/';
		const wantTracks = ('t' in args) ? [].concat(args['t']) : [];
		const faustOut = args['faust-out'] ? args['faust-out'] + '/' : undefined;
		const inDir = args._[1];
		build({ inDir, outDir, wantTracks, faustOut });
	},
	'serve-editor': async args => {
		console.log('Important: serve-editor is not suitable for public-facing servers!');
		console.log('Use generate-editor for publishing.');
		const teaDir = path.dirname(path.fromFileUrl(import.meta.url));
		const config = await readConfig(args, teaDir);
		serveEditor(config, teaDir);
	},
	'generate-editor': async args => {
		console.log('Note: in order to support deeplinks (optional), '+
			'the static host should be configured to serve /index.html as 404 page.');
		const teaDir = path.dirname(path.fromFileUrl(import.meta.url));
		const config = await readConfig(args, teaDir);
		const outDir = args._[1];
		await generateEditor(config, teaDir, outDir, args.y);
	},
	async macro(args) {
		if (args._.length !== 4) helpAndExit();
		console.time('macro rendering time');
		const content = await Deno.readTextFile('./' + args._[2]);
		const lines = content.split('\n');
		const r = new MultiRenderer();

		// i think the web version reuses params from oldTrack
		// todo make this more consistent between versions
		macroEvents.startTrack = (trackName, params, oldTrack) => {
			const paramObj = {};
			for (const p of params) paramObj[p.name] = p.valStr;
			const mainPath = path.join(args._[1], trackName, 'main.js');
			return r.addTrack(mainPath, paramObj);
		};
		macroEvents.tweakTrack = (cmdTrack, param) => {
			if (!cmdTrack) throw new Error('no such track.');
			r.tweakTrack(cmdTrack, { [param.name]: param.valStr });
		};
		macroEvents.stopTrack = (cmdTrack) => {
			if (!cmdTrack) throw new Error('no such track.');
			r.removeTrack(cmdTrack);
		};
		macroEvents.setHighlight = (file, lineNum) => {
			console.log(lines[lineNum-1]);
		};
		console.log('rendering...');
		const outHandle = await r.addOutput(args._[3]);
		let nowStamp = 0;
		while (true) {
			const nextStamp = playUpToStamp(content, nowStamp);
			if (nextStamp === Number.MAX_VALUE) {
				await r.removeOutput(outHandle);
				break;
			}
			await r.render((nextStamp - nowStamp)/1000);
			nowStamp = nextStamp;
		}
		await r.finalize();
		console.timeEnd('macro rendering time');
	},
	subprocess
};

if (import.meta.main) {
	const args = parse(Deno.args);
	const action = commandActions[args._[0]];
	if (action) action(args);
	else helpAndExit();
}

export { loadTrack, parseParamArgs, createRenderer, build };