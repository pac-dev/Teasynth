import { serve, serveFile, copy, exists, path } from './deps.js';
import { path2proj } from './build.js';

const join = path.join;

const req2jsonObj = async (reqPath, config) => {
	// remove trailing '/project.json'
	const key = reqPath.slice(0, -13) || '/';
	const localPath = config.projects[key];
	if (!localPath) {
		console.log(`Requested missing key: ${key}`);
		return;
	}
	if (!await exists(localPath)) {
		console.log(`Could not find project: ${key} -> ${localPath}`);
		return;
	}
	const proj = path2proj(localPath);
	return proj.toJsonObj();
};

const scaredCopy = async (src, dst, yes) => {
	if (yes) {
		console.log(`Copying ${src} to ${dst}`);
	} else {
		console.log('From: ' + src);
		console.log('To: ' + dst);
		const answer = prompt('Copy? (y/n)');
		if (answer !== 'y') Deno.exit();
	}
	await copy(src, dst, { overwrite: true });
};

export const readConfig = async (args, teaDir) => {
	const configPath = args['config'] ?? join(teaDir, 'cli/projects.default.json');
	const configDir = path.dirname(configPath);
	const config = JSON.parse(await Deno.readTextFile(configPath));
	if (args['config']) {
		console.log('Loaded config:');
		console.dir(config);
	}
	for (let [urlPath, localPath] of Object.entries(config.projects)) {
		if (!localPath.startsWith('/')) {
			config.projects[urlPath] = join(configDir, localPath);
		}
	}
	return config;
};

export const serveEditor = (config, teaDir) => {
	const handler = async req => {
		const reqPath = new URL(req.url).pathname;
		let fsPath;
		if (reqPath.endsWith('/project.json')) {
			const obj = await req2jsonObj(reqPath, config);
			if (obj) return new Response(
				JSON.stringify(obj), 
				{ 'Content-Type': 'application/json' }
			);
		} else if (reqPath.startsWith('/editor-js') || reqPath.startsWith('/core')) {
			fsPath = join(teaDir, reqPath);
		} else {
			fsPath = join(teaDir, 'editor-static', reqPath);
		}
		if (reqPath === '/' || !fsPath || !await exists(fsPath)) {
			fsPath = join(teaDir, 'editor-static/index.html');
		}
		const response = await serveFile(req, fsPath);
		return response;
	};
	console.log('Serving Teasynth at: http://localhost:8000/');
	serve(handler, { port: 8000 });
};

export const generateEditor = async (config, teaDir, outDir, yes) => {
	await Deno.mkdir(outDir, { recursive: true });
	await scaredCopy(join(teaDir, 'editor-static'), outDir, yes);
	await scaredCopy(join(teaDir, 'editor-js'), join(outDir, 'editor-js'), yes);
	await scaredCopy(join(teaDir, 'core'), join(outDir, 'core'), yes);
	for (let [urlPath, srcPath] of Object.entries(config.projects)) {
		if (!await exists(srcPath)) return console.log('Could not find ' + srcPath);
		await Deno.mkdir(join(outDir, urlPath), { recursive: true });
		const dstPath = join(outDir, urlPath, 'project.json');
		const proj = path2proj(srcPath);
		if (yes) {
			console.log('Writing to ' + dstPath);
		} else {
			console.log('To: ' + dstPath);
			const answer = prompt('Write? (y/n)');
			if (answer !== 'y') Deno.exit();
		}
		Deno.writeTextFileSync(dstPath, JSON.stringify(proj.toJsonObj()));
	}
};