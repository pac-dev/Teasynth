import { parse, path } from './cli/deps.js';
import { loadPatch, parseParamArgs, createRenderer } from './cli/render.js';
import { build } from './cli/build.js';
import { readConfig, serveEditor, generateEditor } from './cli/editor.js';
import { MultiRenderer } from './cli/multirender.js';
import { renderMacro } from './cli/rendermacro.js';

const helpText = `
Teasynth command line.
If installed, invoke with: teasynth
Otherwise, use: deno run -A teasynth.js

SUBCOMMAND: RENDER
------------------
Render a patch to an audio file.
Usage: teasynth render MAINFILE OUTFILE [-t=DURATION] [--p-PARAM=X ...]
Arguments:
    MAINFILE        path to the main.js of the patch to render
    OUTFILE         path to the output audio file
    -t=DURATION     seconds of audio to render, default 10
    --p-PARAM=X     set value of patch parameter PARAM to X
Example 1: teasynth render projects/startup/1-welcome/main.js test.js
    Renders the included test file for the default 10 seconds
Example 2: teasynth render example/main.js --p-lopass=500 --p-hipass=900
    Renders an example patch with values for parameters "lopass" and "hipass"

SUBCOMMAND: BUILD
-----------------
Build patches from a project into js+wasm bundles.
Usage: teasynth build PROJDIR OUTDIR [--patch=NAME ...]
Arguments:
    PROJDIR         path to project directory containing patches
    OUTDIR          path to output directory
    --patch=X       only build specified patches
Example 1: teasynth build projects/startup/ bundles/
    Build all patches in the included test project
Example 2: teasynth build example/ bundles/ --patch=bell --patch=whistle
    Build only "bell" and "whistle" patches of an example project

SUBCOMMAND: SERVE-EDITOR
------------------------
Serve the Teasynth web editor locally.
Usage: teasynth serve-editor [--config=FILE]
Arguments:
    --config=FILE   optional path to configuration file.
                    the default is cli/config.default.json

SUBCOMMAND: GENERATE-EDITOR
---------------------------
Generate the Teasynth editor static website for deployment.
Usage: teasynth generate-editor OUTDIR [--config FILE] [-y]
Arguments:
    OUTDIR          path to output directory
    --config=FILE   optional path to configuration file.
                    the default is cli/config.default.json
    -y              answer "yes" to all confirmation prompts

SUBCOMMAND: MACRO
-----------------
Render a macro file to an audio file.
Usage: teasynth macro PROJDIR MACFILE OUTFILE
Arguments:
    PROJDIR         path to project directory containing patches
    MACFILE         path to macro text file
    OUTFILE         path to the output audio file
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
		const wantPatches = ('patch' in args) ? [].concat(args['patch']) : [];
		const faustOut = args['faust-out'] ? args['faust-out'] + '/' : undefined;
		const inDir = args._[1];
		build({ inDir, outDir, wantPatches, faustOut });
	},
	'serve-editor': async (args) => {
		console.log('Note: serve-editor is not suitable for public-facing servers.');
		console.log('Use generate-editor for publishing.');
		const teaDir = path.dirname(path.fromFileUrl(import.meta.url));
		const config = await readConfig(args, teaDir);
		serveEditor(config, teaDir);
	},
	'generate-editor': async (args) => {
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