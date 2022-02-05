import { parse, bold, cyan, serve, serveFile, existsSync } from './cli/deps.js';
import { loadTrack, parseParamArgs, createRenderer } from './cli/render.js';
import { build } from './cli/build.js';

const cmd = txt => cyan(bold(txt));

const helpText = `
Teasynth command line.
If installed, invoke with: ${cmd('teasynth')}
Otherwise, use: ${cmd('deno run -A teasynth.js')}

Subcommands:

  ${cmd('render')}: Render a track to an audio file.
    Usage: ${cmd('teasynth render MAINFILE OUTFILE [-t DURATION] [-p-PARAM X ...]')}
  ${cmd('build')}: Build tracks from a project into js+wasm bundles.
    Usage: ${cmd('teasynth build PROJDIR OUTDIR [--track NAME]')}
  ${cmd('serve-editor')}: Serve the Teasynth web editor locally.
    Usage: ${cmd('teasynth serve-editor [--config FILE]')}
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
	'serve-editor': async () => {
		const base = Deno.cwd() + '/web-editor';
		const handler = async req => {
			const reqPath = new URL(req.url).pathname;
			let fsPath;
			if (reqPath === '/') fsPath = base + '/index.html';
			else fsPath = base + reqPath;
			if (existsSync(fsPath)) {
				const response = await serveFile(req, fsPath);
				return response;
			} else {
				return new Response('404: Not Found', { status: 404 });
			}
		};
		console.log('http://localhost:8000/');
		serve(handler, { port: 8000 });
	}
};

if (import.meta.main) {
	const args = parse(Deno.args);
	const action = commandActions[args._[0]];
	if (action) action(args);
	else helpAndExit();
}