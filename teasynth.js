import { parse, bold, cyan, path } from './cli/deps.js';
import { loadPatch, parseParamArgs, createRenderer } from './cli/render.js';
import { build } from './cli/build.js';
import { readConfig, serveEditor, generateEditor } from './cli/editor.js';
import { MultiRenderer } from './cli/multirender.js';
import { renderMacro } from './cli/rendermacro.js';

const cmd = txt => cyan(bold(txt));

const helpText = `
Teasynth command line.
If installed, invoke with: ${cmd('teasynth')}
Otherwise, use: ${cmd('deno run -A --unstable teasynth.js')}

Subcommands:

  ${cmd('render')}: Render a patch to an audio file.
    Usage: ${cmd('teasynth render MAINFILE OUTFILE [-t DURATION] [-p-PARAM X ...]')}
  ${cmd('build')}: Build patches from a project into js+wasm bundles.
    Usage: ${cmd('teasynth build PROJDIR OUTDIR [--patch NAME]')}
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
		const patch = await loadPatch('./' + args._[1]);
		patch.setParams(parseParamArgs(args));
		const r = createRenderer(patch);
		console.log('rendering...');
		const pipe = await r.addOutput(args._[2]);
		await r.render(dur);
		await r.removeOutput(pipe);
	},
	async build(args) {
		if (args._.length !== 3) helpAndExit();
		const outDir = args._[2] + '/';
		const wantPatches = ('t' in args) ? [].concat(args['t']) : [];
		const faustOut = args['faust-out'] ? args['faust-out'] + '/' : undefined;
		const inDir = args._[1];
		build({ inDir, outDir, wantPatches, faustOut });
	},
	'serve-editor': async args => {
		console.log('Note: serve-editor is not suitable for public-facing servers.');
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
		await renderMacro(args._[1], args._[2], args._[3])
		console.timeEnd('macro rendering time');
	}
};

if (import.meta.main) {
	const args = parse(Deno.args);
	const action = commandActions[args._[0]];
	if (action) action(args);
	else helpAndExit();
}

export { loadPatch, parseParamArgs, createRenderer, build, MultiRenderer, renderMacro };