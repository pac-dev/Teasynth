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

/**
 * @param {Project} proj 
 * @param {ProjFile} main 
 */
const buildTrack = async (proj, main) => {
	const trackName = 'worklet_' + main.parent.name;
	const sources = {};
	for (let file of proj.files) {
		if (file.isDir) continue;
		sources['/' + file.path] = file.content;
	}
	sources['/export_worklet.js'] = makeWorklet('./'+main.path, './host.js', trackName);
	console.log(`bundling ${main.parent.path}...`);
	const { files } = await Deno.emit(
		"/export_worklet.js",
		{ sources, bundle: "module" }
	);
	const outFiles = {
		[trackName+'.js']: files['deno:///bundle.js']
	};
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

export const build = async ({ inDir, outDir, wantTracks, faustOut }) => {
	Deno.mkdirSync(outDir, {recursive: true});
	const proj = new Project('workspace');
	console.log('reading input project...');
	walkFs(inDir, proj.root);
	for (let main of proj.files) {
		if (main.name !== 'main.js') continue;
		if (main.path.includes('failed')) continue;
		const exFiles = await buildTrack(proj, main);

		const tPath = outDir+main.parent.path+'/';
		if (!wantTracks.length || wantTracks.includes(main.parent.name)) {
			Deno.mkdirSync(tPath, {recursive: true});
		}
		for (let filename of Object.keys(exFiles)) {
			if (wantTracks.length && filename.endsWith('.js') && !wantTracks.includes(main.parent.name)) {
				continue;
			}
			const path = (faustOut && filename.match(/(\.wasm|\.json)$/)) ? faustOut : tPath;
			if (typeof exFiles[filename] === 'string') {
				Deno.writeTextFileSync(path+filename, exFiles[filename])
			} else {
				Deno.writeFileSync(path+filename, exFiles[filename])
			}
		}
	}
	console.log('done.');
};