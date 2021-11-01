import { JSZip } from './jszipModule.js';
import { ProjFile, Project } from './Project.js';
import { makeWorklet } from './worklet.js';
import { compileFaust } from './faustCompiler.js';

const absolutize = (importer, importPath) => {
	const retComponents = importer.split('/');
	const impComponents = importPath.split('/');
	retComponents.pop();
	for (let comp of impComponents) {
		if (comp === '.') continue;
		else if (comp === '..') retComponents.pop();
		else retComponents.push(comp);
	}
	return retComponents.join('/');
};

/**
 * @param {Project} proj
 */
const projPlugin = proj => ({
	name: 'proj',
	setup(build) {
		// Tag all resolves with proj-ns, probably unnecessarily
		build.onResolve({ filter: /.*/ }, args => {
			// console.log(`${args.importer}, ${args.path} => ${absolutize(args.resolveDir, args.path)}`)
			return {
				path: absolutize(args.importer, args.path),
				namespace: 'proj-ns',
			}
		})

		// Load paths tagged with the "proj-ns" namespace
		build.onLoad({ filter: /.*/, namespace: 'proj-ns' }, args => ({
			contents: proj.findByPath(args.path).content,
			loader: 'js',
		}))
	},
});

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

let esbuild;

/**
 * @param {Project} proj
 * @param {ProjFile} main
 */
export const exportTrack = async (proj, main, esbuild_in) => {
	if (!esbuild && esbuild_in) {
		esbuild = esbuild_in;
	}
	if (!esbuild) {
		console.log('initializing esbuild...');
		esbuild = await import('./esbuild-wasm/esm/browser.min.js');
		await esbuild.initialize({
			wasmURL: 'js/shared/esbuild-wasm/esbuild.wasm',
		});
	}
	const trackName = 'worklet_' + main.parent.name;
	const worklet = makeWorklet('./'+main.path, './platform.js', trackName);
	console.log(`esbuild: bundling ${main.parent.path}...`);
	const result = await esbuild.build({
		bundle: true,
		plugins: [projPlugin(proj)],
		stdin: {
			contents: worklet,
			resolveDir: '',
			sourcefile: 'export_worklet.js',
			loader: 'js'
		},
		write: false,
	});
	const outFiles = {
		[trackName+'.js']: result.outputFiles[0].contents
	};
	const faustSources = [...main.parent.descendants].filter(f => f.name.endsWith('.dsp'));
	console.log('compiling Faust souces...');
	for (let f of faustSources) {
		const hash = cyrb53(f.content);
		const comp = await compileFaust(f.content, false); // always use faust instancing
		outFiles[hash+'.wasm'] = comp.ui8Code;
		outFiles[hash+'.json'] = JSON.stringify(comp.dspMeta);
	}
	return outFiles;
};

export const zipify = async files => {
	const zip = new JSZip();
	for (let filename of Object.keys(files)) {
		zip.file(filename, files[filename]);
	}
	return await zip.generateAsync({type:'blob'});
}