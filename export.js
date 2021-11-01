import { exportTrack } from './web-editor/js/shared/exporter.js';
import { Project, ProjFile, ProjDir } from './web-editor/js/shared/Project.js';
import * as esbuild from "https://deno.land/x/esbuild@v0.13.8/mod.js";

const helpText = `
Teagen exporter.

Usage:
deno run -A export.js PROJ OUT

Export tracks from the given Teagen project (PROJ) into the OUT folder. Each
track's main.js is bundled into an AudioWorklet JS file. Faust sources are
precompiled into wasm+json files in the export folder.

Usage with "fine" permissions:
deno run --allow-read=$PWD --allow-write=OUT,$HOME/.cache/esbuild/bin --allow-env=ESBUILD_BINARY_PATH,XDG_CACHE_HOME,HOME --allow-net --allow-run=$HOME/.cache/esbuild/bin/esbuild-linux-64@0.13.8 export.js PROJ OUT
`;

const helpAndExit = () => {
	console.log(helpText);
	Deno.exit();
};

if (Deno.args.length !== 2) helpAndExit();

const outDir = Deno.args[1].replace(/k$/, '') + '/';
Deno.mkdirSync(outDir, {recursive: true});

const proj = new Project('workspace');

/**
 * @param {String} fsPath 
 * @param {ProjDir} projDir 
 */
const walkFs = (fsPath, projDir) => {
	for (const dirEntry of Deno.readDirSync(fsPath)) {
		const entryPath = `${fsPath}/${dirEntry.name}`;
		let projChild;
		if (dirEntry.isDirectory) {
			projChild = new ProjDir(dirEntry.name);
			walkFs(entryPath, projChild);
		} else {
			const content = Deno.readTextFileSync(entryPath);
			projChild = new ProjFile(dirEntry.name, content);
		}
		projDir.addChild(projChild);
	}
};
console.log('reading input project...');
walkFs(Deno.args[0], proj.root);

const mains = [...proj.files].filter(f => f.name === 'main.js');
for (let main of mains) {
	const exFiles = await exportTrack(proj, main, esbuild);
	const tPath = outDir+main.parent.path;
	Deno.mkdirSync(tPath, {recursive: true});
	for (let filename of Object.keys(exFiles)) {
		Deno.writeTextFileSync(tPath+'/'+filename, exFiles[filename])
	}
}
console.log('done.');
esbuild.stop();