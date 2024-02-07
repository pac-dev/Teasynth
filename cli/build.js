import { path, bundle } from './deps.js';
import { compileFaust } from '../core/faustCompiler.js';
import { Project, ProjFile, ProjDir } from '../core/project.js';
import { makeWorklet } from '../core/worklet.js';

const cyrb53 = (str, seed = 0) => {
	let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
	for (let i = 0, ch; i < str.length; i++) {
		ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
	h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1>>>0);
};

/**
 * @param {String} fsPath 
 * @param {ProjDir} projDir 
 */
const walkFs = (fsPath, projDir) => {
	for (const dirEntry of Deno.readDirSync(fsPath)) {
		const entryPath = path.join(fsPath, dirEntry.name);
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

/**
 * @param {string} projPath 
 * @returns Project
 */
export const path2proj = projPath => {
	const name = path.basename(projPath);
	const ret = new Project(name);
	walkFs(projPath, ret.root);
	return ret;
};

/**
 * @param {Project} proj 
 * @param {ProjFile} main 
 */
const buildPatch = async (proj, main) => {
	const patchName = 'worklet_' + main.parent.name;
	const sources = {};
	for (let file of proj.files) {
		if (file.isDir) continue;
		sources['file:///' + file.path] = file.content;
	}
	sources['file:///export_worklet.js'] = makeWorklet('./'+main.path, './host.js', patchName);
	const load = async (path) => ({
		kind: 'module',
		specifier: path,
		content: sources[path]
	});
	// note: compilerOptions doesn't work, and inline source maps are included anyways.
	// this is a regression from previous deno versions.
	// for updates, see: https://github.com/denoland/deno_emit/issues/29
	const compilerOptions = { sourceMap: false, inlineSourceMap: false };
	console.log(`bundling ${main.parent.path}...`);
	const { code } = await bundle('/export_worklet.js', { load, compilerOptions });
	const outFiles = { [patchName+'.js']: code };
	const faustSources = [...main.parent.descendants].filter(f => f.name.endsWith('.dsp'));
	console.log('compiling Faust souces...');
	for (let f of faustSources) {
		const hash = cyrb53(f.content);
		const comp = await compileFaust(f.content, false);
		outFiles[hash+'.wasm'] = comp.ui8Code;
		outFiles[hash+'.json'] = JSON.stringify(comp.dspMeta);
	}
	return outFiles;
};

export const build = async ({ inDir, outDir, faustOut, wantPatches = [] }) => {
	Deno.mkdirSync(outDir, {recursive: true});
	console.log('reading input project...');
	const proj = path2proj(inDir);
	for (let main of proj.files) {
		if (main.name !== 'main.js') continue;
		if (main.path.includes('failed')) continue;
		const exFiles = await buildPatch(proj, main);

		const tPath = path.join(outDir, main.parent.path);
		if (!wantPatches.length || wantPatches.includes(main.parent.name)) {
			Deno.mkdirSync(tPath, {recursive: true});
		}
		for (let filename of Object.keys(exFiles)) {
			if (wantPatches.length && filename.endsWith('.js') && !wantPatches.includes(main.parent.name)) {
				continue;
			}
			let outPath = (faustOut && filename.match(/(\.wasm|\.json)$/)) ? faustOut : tPath;
			outPath = path.join(outPath, filename);
			if (typeof exFiles[filename] === 'string') {
				Deno.writeTextFileSync(outPath, exFiles[filename])
			} else {
				Deno.writeFileSync(outPath, exFiles[filename])
			}
		}
	}
	console.log('done.');
};