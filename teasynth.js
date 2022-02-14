import { parse, bold, cyan, dirname } from './cli/deps.js';
import { loadTrack, parseParamArgs, createRenderer } from './cli/render.js';
import { build } from './cli/build.js';
import { readConfig, serveEditor, generateEditor } from './cli/editor.js';

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
		const teaDir = dirname(new URL(import.meta.url).pathname);
		const config = await readConfig(args, teaDir);
		serveEditor(config, teaDir);
	},
	'generate-editor': async args => {
		console.log('Static host must be configured to serve /index.html as 404 page.');
		const teaDir = dirname(new URL(import.meta.url).pathname);
		const config = await readConfig(args, teaDir);
		const outDir = args._[1];
		await generateEditor(config, teaDir, outDir, args.y);
	}
};

if (import.meta.main) {
	const args = parse(Deno.args);
	const action = commandActions[args._[0]];
	if (action) action(args);
	else helpAndExit();
}