import { loadPatch } from './render.js';

const parseParamStr = (str) => Function(`"use strict"; return parseFloat(${str})`)();
// Buffer size determines timing accuracy when patches and parameters change.
const bufFrames = 1024;
const bufBytes = bufFrames*2*4; // stereo*(float32/byte)
const sr = 44100;

/**
 * Teasynth multi-track renderer based on starting a new subprocess for each
 * patch. Offers a simple API to add and remove patches and output audio files.
 * 
 * The main reason for this architecture is that it's otherwise impossible to
 * free up memory used by patches. It also allows modules to be loaded multiple
 * times and keep individual global state if they wish (though that could also
 * be done using workers.)
 */
export class MultiRenderer {
	constructor() {
		/** @type {Set.<PatchHandle>} */
		this.patchHandles = new Set();
		this.outHandles = new Set();
		this.controlTasks = [];
		this.mixBuf = new Float32Array(bufFrames*2);
		this.mixView = new Uint8Array(this.mixBuf.buffer);
		this.stageBuf = new Float32Array(bufFrames*2);
		this.stageView = new Uint8Array(this.stageBuf.buffer);
		this.position = 0;
	}
	async addOutput(outPath) {
		console.log('adding output: '+outPath);
		const ext = outPath.split('.').at(-1);
		const cmd = ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0'];
		if (ext === 'mp3') cmd.push('-b:a', '192k');
		cmd.push(outPath);
		const outHandle = Deno.run({ cmd, stdin: 'piped', stderr: 'null' });
		outHandle.mixFn = null;
		this.outHandles.add(outHandle);
		return outHandle;
	}
	async removeOutput(outHandle) {
		console.log('removing output.');
		outHandle.stdin.close();
		await outHandle.status();
		outHandle.close();
		this.outHandles.delete(outHandle);
	}
	addPatch(path, params) {
		const parsedParams = {};
		for (const [k,v] of Object.entries(params)) parsedParams[k] = parseParamStr(v);
		const patchHandle = new PatchHandle();
		this.controlTasks.push(async () => {
			await patchHandle.load(path, parsedParams);
		});
		this.patchHandles.add(patchHandle);
		return patchHandle;
	};
	removePatch(patchHandle) {
		this.controlTasks.push(async () => {
			await patchHandle.exit();
		});
		this.patchHandles.delete(patchHandle);
	};
	tweakPatch(patchHandle, params) {
		const parsedParams = {};
		for (const [k,v] of Object.entries(params)) parsedParams[k] = parseParamStr(v);
		this.controlTasks.push(async () => {
			await patchHandle.tweak(parsedParams);
		});
	};
	/** @param {Number} dur - duration to render in seconds */
	async render(dur, { stopAtSplicePoint=false } = {}) {
		// Parallel version doesn't work:
		// await Promise.all(this.controlTasks.map(task => task()));
		// Fully sequential version works:
		for (const task of this.controlTasks) await task();
		// (a good compromise might be sequential per process)
		this.controlTasks.length = 0;
		let splicePoint = false;
		for (let i=0; i<dur*sr/bufFrames; i++) {
			for (let j=0; j<bufFrames*2; j++) this.mixBuf[j] = 0;
			const renderProms = [...this.patchHandles].map(async (patchHandle) => {
				let block = await patchHandle.process();
				if (block.every(x => x === -1)) {
					splicePoint = true;
					block = await patchHandle.process();
				}
				if (block.every(x => x === -1)) throw new Error('MORE -1?')
				for (let j=0; j<bufFrames*2; j++) this.mixBuf[j] += block[j];
			});
			await Promise.all(renderProms);
			for (const outHandle of this.outHandles) {
				if (outHandle.mixFn) {
					this.mixBuf.forEach((x,i) => this.stageBuf[i] = outHandle.mixFn(x, this.position));
					await outHandle.stdin.write(this.stageView);
				} else {
					await outHandle.stdin.write(this.mixView);
				}
			}
			this.position += bufFrames/sr;
			if (stopAtSplicePoint && splicePoint) return;
		}
	}
	async finalize() {
		for (const task of this.controlTasks) await task();
		const n = this.patchHandles.size;
		if (n) console.log(`Rendering done but ${n} patches still in playing state!`)
	}
}

/**
 * Helper class to start and communicate with child processes.
 */
class PatchHandle {
	constructor() {
		const command = new Deno.Command(Deno.execPath(), {
			args: ['run', '-A', import.meta.url],
			stdin: 'piped', stdout: 'piped'
		});
		this.proc = command.spawn();
		this.writer = this.proc.stdin.getWriter();
		this.reader = this.proc.stdout.getReader();
	}
	async rpc(args) {
		await this.writer.write(new TextEncoder().encode(JSON.stringify(args)));
		const readResp = await this.reader.read();
		if (readResp.done) throw new Error('\nA child process stopped responding. '
			+ 'This could be due to:\n'
			+ '\t- An error in the child process, which might not be output here.\n'
			+ '\t  Try running the code in the browser version of Teasynth to debug.\n'
			+ '\t- Possibly running out of memory. Try checking resource usage.\n');
		return readResp.value;
	}
	async load(path, initParams) {
		const resp = await this.rpc({ fn: 'load', path });
		if (new TextDecoder().decode(resp) !== 'ok') throw new Error('RPC load error');
		await this.tweak(initParams);
	}
	async tweak(params) {
		const resp = await this.rpc({ fn: 'set', params });
		if (new TextDecoder().decode(resp) !== 'ok') throw new Error('RPC set error');
	}
	async process() {
		const resp = await this.rpc({ fn: 'process' });
		if (resp.length < bufBytes) {
			// this seems to happen rarely, otherwise it should be optimized
			console.log('got partial pipe output, catching up...')
			const slowBuf = new Uint8Array(bufBytes);
			for (const [k,v] of resp.entries()) slowBuf[k] = v;
			let bytesRead = resp.length;
			while (bytesRead < bufBytes) {
				const resp2 = (await this.reader.read()).value;
				for (const [k,v] of resp2.entries()) slowBuf[bytesRead + k] = v;
				bytesRead += resp2.length;
			}
			return new Float32Array(slowBuf.buffer, 0, bufFrames*2);
		}
		if (resp.length > bufBytes) throw new Error(`got too many bytes: ${resp.length} instead of ${bufBytes}. `);
		return new Float32Array(resp.buffer, 0, bufFrames*2);
	}
	async exit() {
		await this.writer.write(new TextEncoder().encode(JSON.stringify({ fn: 'exit' })));
		await this.writer.close();
	}
}

/**
 * Call this in child processes to load patches and generate audio.
 */
const subprocess = async () => {
	// In Deno, these console functions print to stdout by default. We're piping
	// data through stdout, so this would cause problems (eg. "broken pipe").
	// I'd also like to avoid idiosyncrasies like "never use console.log in
	// teasynth modules", so let's redirect them to stderr:
	console.debug = function() { return console.warn.apply(null, arguments); };
	console.info = function() { return console.warn.apply(null, arguments); };
	console.log = function() { return console.warn.apply(null, arguments); };

	const outBuf = new Float32Array(bufFrames*2);
	const outView = new Uint8Array(outBuf.buffer);
	const stdWriter = Deno.stdout.writable.getWriter();
	let patch;
	const fns = {
		async load({ path }) {
			patch = await loadPatch(path);
			await Deno.stdout.write(new TextEncoder().encode('ok'));
		},
		async set({ params }) {
			patch.setParams(params);
			await Deno.stdout.write(new TextEncoder().encode('ok'));
		},
		async process() {
			if (patch.host.splicePoint) {
				delete patch.host.splicePoint;
				outBuf.fill(-1);
				return await stdWriter.write(outView);
			}
			for (let i=0; i<bufFrames; i++) {
				if (!(i % 128)) {
					// This yields control to the event loop, forcing the entire
					// microtask queue to get processed. Roughly simulates what
					// happens between audio blocks in the browser environment.
					await new Promise((resolve) => setTimeout(resolve));
					// alternatively we could use several "await null" here,
					// which is 1-5% faster for patches but more precarious.
				}
				[outBuf[i*2], outBuf[i*2+1]] = patch.process();
			}
			await stdWriter.write(outView);
		},
		async exit() {
			Deno.exit();
		}
	};
	for await (const chunk of Deno.stdin.readable) {
		const args = JSON.parse(new TextDecoder().decode(chunk));
		const fn = fns[args.fn];
		if (!fn) throw new Error('brother, what did you put in the pipe');
		await fn(args);
	}
};

if (import.meta.main) {
	await subprocess();
}