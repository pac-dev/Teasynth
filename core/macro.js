/**
 * The teasynth macro system. It's not pretty, but it allows recording, playing
 * back and rendering "performances" where patches are loaded, tweaked, etc. It
 * follows a simple and easily editable text format.
 * 
 * Currently limited in style, because timing is inaccurate in the browser
 * context, were functions like "setTimeout" are used for macro events.
 * 
 * In the command line context, timing is consistent and accurate to the
 * block/buffer level.
 */

/**
 * @typedef {Object} ParamChange
 * @property {string} param
 * @property {string} valStr
 * @property {number} offset
 */

/**
 * @typedef {Object} MacroEvent
 * @property {('start'|'stop'|'tweak')} type
 * @property {number?} stamp
 * @property {string?} patchName
 * @property {number?} instance
 * @property {Array<Object>?} params
 * @property {Array<ParamChange>?} paramChanges
 */

/**
 * @typedef {Object} Instance
 * @property {string} patchName
 * @property {number} patchInstance
 * @property {import('../editor-js/devPlayer.js').DevPatch} devPatch
 */

/** @type {import('./project.js').ProjFile} */
let tgtFile;
/** @type {('stopped'|'playing'|'recording'|'playing paused'|'recording paused')} */
let status = 'stopped';
/** @type {Array<Instance>} */
let instances = [];
let playingLine, startDate, startStamp = 0;

const getCurrentStamp = () => startStamp + (new Date() - startDate);
const fmtStamp = (t) => {
	t = Math.floor(t / 1000);
	const min = Math.floor(t / 60);
	const sec = t % 60;
	return (min<10?'0':'') + min + ':' + (sec<10?'0':'') + sec;
};
const parseStamp = (str) => {
	const [min, sec] = str.split(':');
	const ret = (Number(min)*60 + Number(sec)) * 1000;
	if (isNaN(ret)) throw new Error('Error parsing timestamp: '+str);
	return ret;
};
const extractStamp = (line) => {
	const matches = /^(\d\d:\d\d) ?(.*?$)/.exec(line);
	if (!matches) return [null, line.trim()];
	return [parseStamp(matches[1]), matches[2].trim()];
};

// Start recording a macro to file f
const rec = (f) => {
	if (status === 'playing') {
		if (timeoutId !== -1) {
			globalThis.clearTimeout(timeoutId);
			timeoutId = -1;
		}
		macroEvents.setHighlight(tgtFile);
		startStamp = getCurrentStamp();
	} else if (status !== 'stopped') {
		stop();
	}
	tgtFile = f;
	startDate = new Date();
	intervalId = globalThis.setInterval(checkStreak, 600);
	status = 'recording';
};

// Start playing macro file f
const play = (f) => {
	if (status !== 'stopped') stop();
	tgtFile = f;
	startDate = new Date();
	if (startStamp) playingLine = findStampLine(startStamp);
	else playingLine = -1;
	status = 'playing';
	playUsingTimer();
};

// Pause recording or playing (this does not pause the patches)
const pause = () => {
	if (status !== 'playing' && status !== 'recording') return;
	if (status === 'recording') checkStreak(true);
	status += ' paused';
	startStamp = getCurrentStamp();
};

// Resume paused recording or playing
const resume = () => {
	if (!status.endsWith(' paused')) return;
	status = status.replace(' paused', '');
	startDate = new Date();
	if (status === 'playing') playUsingTimer();
};

// Stop and reset the cursor
const stop = () => {
	if (status === 'stopped') return;
	if (status === 'recording') checkStreak(true);
	if (intervalId !== -1) {
		globalThis.clearInterval(intervalId);
		intervalId = -1;
	}
	if (timeoutId !== -1) {
		globalThis.clearTimeout(timeoutId);
		timeoutId = -1;
	}
	status = 'stopped';
	startStamp = 0;
	macroEvents.setHighlight(tgtFile);
	tgtFile = undefined;
	instances.length = 0;
};

export const offlineInit = () => { playingLine = -1 };

/** @param {Instance} search  */
const getInstance = (search) => instances.find(
	i => Object.entries(search).every(([k,v]) => i[k] === v)
);

const setInstance = (patchName, patchInstance, devPatch) => {
	const oldi1 = instances.findIndex(i => i.patchName === patchName && i.patchInstance === patchInstance);
	if (oldi1 !== -1) instances.splice(oldi1, 1);
	const oldi2 = instances.findIndex(i => i.devPatch === devPatch);
	if (oldi2 !== -1) instances.splice(oldi2, 1);
	if (oldi1 !== -1 || oldi2 !== -1) console.log(`overwriting instance ${patchName} #${patchInstance}`);
	instances.push({ patchName, patchInstance, devPatch });
};

/** @param {Array<ParamChange>} paramChanges */
const serializeValues = (paramChanges) => {
	const head = paramChanges[0].param + ': ';
	if (paramChanges.length === 1) return head + paramChanges[0].valStr;
	else return head + paramChanges.map(pc => pc.offset+'='+pc.valStr).join(', ');
};

/** @param {MacroEvent} event */
const serialize = (event) => {
	let ret = `${event.type} ${event.patchName}`;
	if (event.instance !== 1) ret += ' #' + event.instance;
	ret += '. ';
	if (!event.paramChanges) return ret;
	const params = {};
	for (const pc of event.paramChanges) {
		params[pc.param] ??= [];
		params[pc.param].push(pc);
	}
	ret += Object.entries(params).map(([_, values]) => serializeValues(values)).join(', ');
	return ret;
};

// Create a paramChange object from the current full param state
const param2paramChange = (param) => {
	let valStr = param.valStr;
	if (valStr === undefined) {
		if (param.val >= 1000) valStr = Math.round(param.val);
		else if (param.val >= 100) valStr = Math.round(param.val*10)/10;
		else valStr = Math.round(param.val*100)/100;
	}
	return { 'param': param.name, valStr };
};

/** @type {Array<MacroEvent>} */
let reclog = [];
let intervalId = -1, timeoutId = -1;

// Returns true if the two events are part of the same parameter change streak
const isStreak = (e1, e2) => {
	return (
		e1.paramChanges[0].param === e2.paramChanges[0].param
		&& e1.patchName === e2.patchName
		&& e1.instance === e2.instance
	);
};

// Merge and write a streak of parameter changes
const writeStreak = () => {
	const duration = reclog.slice(-1)[0].stamp - reclog[0].stamp;
	const iStep = duration > 4000 ? 1 : 2;
	/** @type {MacroEvent} */
	const merged = Object.assign({}, reclog[0]);
	merged.paramChanges[0].offset = 0;
	let prevOffset = 0;
	for (const evt of reclog) {
		const offset = Math.round((evt.stamp - reclog[0].stamp)*iStep/1000)/iStep;
		if (offset === prevOffset) continue;
		merged.paramChanges.push(Object.assign({}, evt.paramChanges[0], { offset }));
		prevOffset = offset;
	}
	merged.paramChanges.slice(-1)[0].valStr = reclog.slice(-1)[0].paramChanges[0].valStr;
	tgtFile.content += '\n'+fmtStamp(merged.stamp)+' '+serialize(merged);
	macroEvents.fileChanged();
	reclog = [];
};

// Write the current streak if it's getting old
const checkStreak = (force=false) => {
	if (!reclog.length) return;
	const lastEvt = reclog[reclog.length - 1];
	if (force || getCurrentStamp() - lastEvt.stamp > 2000) writeStreak();
};

/**
 * @param {MacroEvent} event 
 * @param {import('../editor-js/devPlayer.js').DevPatch} devPatch 
 */
const recEvent = (event, devPatch) => {
	if (status !== 'recording') return;
	if (!tgtFile.content.length) startDate = new Date();
	event.stamp = getCurrentStamp();
	event.patchName = devPatch.name;
	if (!getInstance({ devPatch })) {
		const i = instances.filter(i => i.patchName === event.patchName).length;
		setInstance(event.patchName, i + 1, devPatch);
	}
	event.instance = getInstance({ devPatch }).patchInstance;
	if (event.type === 'start') {
		event.paramChanges = devPatch.params.map(param2paramChange);
	}
	if (event.type === 'tweak') {
		event.paramChanges = event.params.map(param2paramChange);
	}
	if (event.type === 'tweak' && reclog.length && isStreak(reclog[0], event)) {
		// we're in the process of automating a param. keep gathering before writing
		return reclog.push(event);
	}
	// we were automating a param, which can now be written
	if (reclog.length) writeStreak();
	if (event.type === 'tweak') {
		// we're starting a new param automation streak
		return reclog.push(event);
	}
	tgtFile.content += '\n'+fmtStamp(event.stamp)+' '+serialize(event);
	macroEvents.fileChanged();
};

const findStampLine = (tgtStamp) => {
	const lines = tgtFile.content.split('\n');
	for (const [n, line] of lines.entries()) {
		const [stamp, command] = extractStamp(line);
		if (stamp === null) continue;
		if (stamp >= tgtStamp) return Math.max(0, n-1);
	}
	return 0;
};

const playUsingTimer = () => {
	if (status !== 'playing') return;
	const nowStamp = getCurrentStamp();
	const nextStamp = playUpToStamp(tgtFile.content, nowStamp);
	if (nextStamp === Number.MAX_VALUE) {
		// playback done
		rec(tgtFile);
		macroEvents.statusChanged();
	}
	timeoutId = globalThis.setTimeout(playUsingTimer, nextStamp - nowStamp);
};

export const playUpToStamp = (content, playStamp) => {
	const nextLine = playLines(content, playStamp);
	const nextBacklog = playBacklog(playStamp);
	return Math.min(nextLine, nextBacklog);
};

let backlog = [];
const playBacklog = (playStamp) => {
	const playNow = backlog.filter(e => e.stamp <= playStamp);
	backlog = backlog.filter(e => e.stamp > playStamp);
	for (const e of playNow) macroEvents.tweakPatch(e.devPatch, e);
	if (!backlog.length) return Number.MAX_VALUE;
	return Math.min(...backlog.map(e => e.stamp));
};

const playLines = (content, playStamp) => {
	const lines = content.split('\n');
	let stamp;
	for (const [n, line] of lines.entries()) {
		if (n <= playingLine || !line.length || line.startsWith('#')) continue;
		const [newStamp, command] = extractStamp(line);
		if (newStamp !== null) {
			stamp = newStamp;
			if (stamp > playStamp + 50) return stamp;
		}
		if (!command) continue;
		playingLine = n;
		macroEvents.setHighlight(tgtFile, n+1, n+1);
		playLine(line);
	}
	// playback done
	return Number.MAX_VALUE;
};

const playLine = (line) => {
	const [lineStamp, command] = extractStamp(line);
	const [head, body] = (command+' ').split('. ').map(s => s.trim());
	const [type, patchName, instanceStr] = head.split(' ');
	const patchInstance = instanceStr ? Number(instanceStr.replace(/^#/, '')) : 1;
	const devPatch = getInstance({ patchName, patchInstance })?.devPatch;
	if (!type || !patchName) throw new Error(
		file.name+` line ${n}: Error parsing event: `+command
	);
	if (type === 'start') {
		const params = body.split(',').filter(s => s).map(s => {
			const [name, valStr] = s.split(':').map(s => s.trim());
			return { name, valStr };
		});
		const newDevPatch = macroEvents.startPatch(patchName, params, devPatch);
		if (newDevPatch !== devPatch) setInstance(patchName, patchInstance, newDevPatch);
	} else if (type === 'stop') {
		macroEvents.stopPatch(devPatch);
	} else if (type === 'tweak') {
		for (const paramStr of body.split(';')) {
			const [name, tail] = paramStr.split(':').map(s => s.trim());
			const changeStrs = tail.split(',');
			if (changeStrs.length === 1) {
				macroEvents.tweakPatch(devPatch, { name, valStr: tail.trim() });
			} else {
				backlog.push(...changeStrs.map(s => {
					const [offset, valStr] = s.split('=').map(s => s.trim());
					return { devPatch, name, valStr, stamp: lineStamp+Number(offset)*1000 };
				}));
			}
		}
	}
};

export const macroEvents = {
	// called when something got recorded to a macro file
	fileChanged: () => {},
	// called when the status changed internally (eg. end of playback)
	statusChanged: () => {},
	startPatch: (patchName, params, devPatch) => {},
	stopPatch: (devPatch) => {},
	tweakPatch: (devPatch, param) => {},
	setHighlight: (file, startLine, endLine) => {},
};

const getCursor = () => fmtStamp(getCurrentStamp());
const setCursor = (str) => {
	startDate = new Date();
	startStamp = parseStamp(str);
};

// eg. tm.reStamp(t => t > 80 ? t + 10 : t)
const reStamp = (fn) => {
	const lines = tgtFile.content.split('\n');
	for (const [n, line] of lines.entries()) {
		const [stamp, cmd] = extractStamp(line);
		if (stamp !== null) lines[n] = fmtStamp(fn(stamp/1000)*1000)+' '+cmd;
	}
	tgtFile.content = lines.join('\n');
	macroEvents.fileChanged();
};

export const macroStatus = () => status;
export const macros = { rec, play, pause, resume, stop, recEvent, getCursor, setCursor, playLine, reStamp };
globalThis.tm = macros;
