import { loadTrack } from './render.js';

const parseParamStr = (str) => Function(`"use strict"; return parseFloat(${str})`)();
// Buffer size determines timing accuracy when tracks and parameters change.
const bufFrames = 1024;
const bufBytes = bufFrames*2*4; // stereo*(float32/byte)
const sr = 44100;

/**
 * Teasynth multi-track renderer based on starting a new subprocess for each
 * track. Offers a simple API to add and remove tracks and output audio files.
 * 
 * The main reason for this architecture is that it's otherwise
 * impossible to free up memory used by tracks. It also allows modules to be
 * loaded multiple times and keep individual global state if they wish (though
 * that could also be done using workers.)
 */
export class MultiRenderer {
	constructor() {
		/** @type {Set.<TrackHandle>} */
		this.trackHandles = new Set();
		this.outHandles = new Set();
		this.controlTasks = [];
		this.mixBuf = new Float32Array(bufFrames*2);
		this.mixView = new Uint8Array(this.mixBuf.buffer);
	}
	async addOutput(outPath) {
		console.log('adding output: '+outPath);
		const ext = outPath.split('.').at(-1);
		const cmd = ['ffmpeg', '-y', '-f', 'f32le', '-channels', '2', '-i', 'pipe:0'];
		if (ext === 'mp3') cmd.push('-b:a', '192k');
		cmd.push(outPath);
		const outHandle = Deno.run({ cmd, stdin: 'piped', stderr: 'piped' });
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
	addTrack(path, params) {
		const parsedParams = {};
		for (const [k,v] of Object.entries(params)) parsedParams[k] = parseParamStr(v);
		const trackHandle = new TrackHandle();
		this.controlTasks.push(async () => {
			await trackHandle.load(path, parsedParams);
		});
		this.trackHandles.add(trackHandle);
		return trackHandle;
	};
	removeTrack(trackHandle) {
		this.controlTasks.push(async () => {
			await trackHandle.exit();
		});
		this.trackHandles.delete(trackHandle);
	};
	tweakTrack(trackHandle, params) {
		const parsedParams = {};
		for (const [k,v] of Object.entries(params)) parsedParams[k] = parseParamStr(v);
		this.controlTasks.push(async () => {
			await trackHandle.tweak(parsedParams);
		});
	};
	/** @param {Number} dur - duration to render in seconds */
	async render(dur) {
		// Parallel version doesn't work:
		// await Promise.all(this.controlTasks.map(task => task()));
		// Fully sequential version works:
		for (const task of this.controlTasks) await task();
		// (a good compromise might be sequential per process)
		this.controlTasks.length = 0;
		for (let i=0; i<dur*sr/bufFrames; i++) {
			for (let j=0; j<bufFrames*2; j++) this.mixBuf[j] = 0;
			const renderProms = [...this.trackHandles].map(async (trackHandle) => {
				const block = await trackHandle.process();
				for (let j=0; j<bufFrames*2; j++) this.mixBuf[j] += block[j];
			});
			await Promise.all(renderProms);
			for (const outHandle of this.outHandles) {
				await outHandle.stdin.write(this.mixView);
			}
		}
	}
	async finalize() {
		for (const task of this.controlTasks) await task();
		const n = this.trackHandles.size;
		if (n) console.log(`Rendering done but ${n} tracks still in playing state!`)
	}
}

/**
 * Helper class to start and communicate with child processes.
 */
class TrackHandle {
	constructor() {
		const command = new Deno.Command(Deno.execPath(), {
			args: ['run', '-A', '--unstable', 'teasynth.js', 'subprocess'],
			stdin: 'piped', stdout: 'piped'
		});
		this.proc = command.spawn();
		this.writer = this.proc.stdin.getWriter();
		this.reader = this.proc.stdout.getReader();
	}
	async rpc(args) {
		await this.writer.write(new TextEncoder().encode(JSON.stringify(args)));
		const readResp = await this.reader.read();
		if (readResp.done) throw new Error(`what do you mean you're done`);
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
 * Call this in child processes to load tracks and generate audio.
 */
export const subprocess = async () => {
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
	let track;
	const fns = {
		async load({ path }) {
			track = await loadTrack(path);
			await Deno.stdout.write(new TextEncoder().encode('ok'));
		},
		async set({ params }) {
			track.setParams(params);
			await Deno.stdout.write(new TextEncoder().encode('ok'));
		},
		async process() {
			for (let i=0; i<bufFrames; i++) {
				if (!(i % 128)) {
					// This yields control to the event loop, forcing the entire
					// microtask queue to get processed. Roughly simulates what
					// happens between audio blocks in the browser environment.
					await new Promise((resolve) => setTimeout(resolve));
					// alternatively we could use several "await null" here,
					// which is 1-5% faster for tracks but more precarious.
				}
				[outBuf[i*2], outBuf[i*2+1]] = track.process();
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