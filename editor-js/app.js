import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { ProjDir, Project, ProjFile } from '../core/project.js';
import { initService, DevPatch, devPatches, parseParamStr } from './devPlayer.js';
import { fsOpen, fsSave, fsSaveAs, canSave } from './fsa.js';
import { macroEvents, macros, macroStatus } from '../core/macro.js';

let proj = new Project('Empty project');
proj.root.addChild(new ProjFile('main.js', ''));
let editingFile = proj.getDefaultMain();
let lastMain = editingFile;
let minimized = false;
macroEvents.fileChanged = () => { editor.updateFiles() };
macroEvents.startPatch = (patchName, params, devPatch) => {
	devPatch ??= new DevPatch(proj, patchName2File(patchName));
	params.forEach(p => { p.val = parseParamStr(p.valStr); });
	devPatch.params = params;
	(async () => {
		await devPatch.play();
		m.redraw();
	})();
	return devPatch;
};
macroEvents.tweakPatch = (devPatch, param) => {
	param.val = parseParamStr(param.valStr);
	devPatch.patch.setParam(param.name, param.val);
	const oldParam = devPatch.params.find(p => p.name === param.name);
	if (oldParam) oldParam.val = param.val;
	if (oldParam && oldParam.valStr) oldParam.valStr = param.valStr;
	m.redraw();
};
macroEvents.stopPatch = async (devPatch) => {
	await devPatch.stop();
	m.redraw();
};
macroEvents.statusChanged = () => m.redraw();

const playCurrent = async ({override=true}={}) => {
	experimentalWarning = undefined;
	let main = editingFile.closestMain;
	if (!main) main = lastMain;
	if (!proj.includes(main)) throw new Error('No main file to play.');
	lastMain = main;
	let devPatch;
	if (override) devPatch = devPatches.findLast(dp => dp.main === main);
	if (!devPatch) devPatch = new DevPatch(proj, main);
	macros.recEvent({ type: 'start' }, devPatch);
	await devPatch.play();
	m.redraw();
};
const showParams = async () => {
	let main = editingFile.closestMain;
	if (!main) main = lastMain;
	if (!proj.includes(main)) throw new Error('No main file to play.');
	lastMain = main;
	const devPatch = new DevPatch(proj, main);
	await devPatch.scanParams();
	m.redraw();
};
const stopAll = async () => {
	for (let dp of devPatches) {
		await dp.stop();
		macros.recEvent({ type: 'stop' }, dp);
	}
	m.redraw();
};
const editor = new CodeEditor(proj, editingFile.id);
macroEvents.setHighlight = editor.setHighlight.bind(editor);
window.getProject = () => proj;
window.getEditor = () => editor;
window.exportProject = async () => {
	const projStr = JSON.stringify(proj.toJsonObj());
	const fileURL = URL.createObjectURL(new Blob([projStr]));
	const a = document.createElement('A');
	a.href = fileURL;
	a.download = 'project.json';
	a.click();
};
editor.addShortcut('Alt+Digit1', 'Teasynth: Play', () => playCurrent());
editor.addShortcut('Alt+Shift+Digit1', 'Teasynth: Play Multi', () => playCurrent({ override: false }));
editor.addShortcut('Alt+Digit2', 'Teasynth: Stop', () => stopAll());
editor.addShortcut('Alt+Digit3', 'Teasynth: Previous File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(files.length+currentIdx-1)%files.length];
	m.redraw();
});
editor.addShortcut('Alt+Digit4', 'Teasynth: Next File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(currentIdx+1)%files.length];
	m.redraw();
});
editor.addShortcut('Alt+Digit5', 'Teasynth: Play Line', () => {
	macros.playLine(editingFile.content.split('\n')[editor.editor.getPosition().lineNumber-1]);
});
const patchName2File = (name) => {
	const file = proj.findByPath(name) ?? proj.findByPath('patches/'+name);
	if (!file) return;
	else if (file.isDir) return file.findChild('main.js');
	else return file;
};
const goToPatchName = patchName => {
	const file = patchName2File(patchName);
	if (!file) return false;
	editingFile = file;
	editingFile.openAncestors();
	m.redraw();
	editor.focus();
	return true;
};

// eg: #soprano?freq1=100*3/2&freq2=100*5/2
const parseUrlFragment = () => {
	const frag = location.hash.replace('#', '');
	const [filePath, paramsStr] = frag.split('?');
	const ret = { filePath, params: [] };
	if (paramsStr) ret.params = paramsStr.split('&').map(str => {
		const [name, valStr] = str.split('=');
		const val = parseParamStr(valStr);
		return { name, val, valStr };
	});
	return ret;
};
const applyUrlFragment = parsedFragment => {
	goToPatchName(parsedFragment.filePath);
	const main = editingFile.closestMain;
	const dp = new DevPatch(proj, main);
	dp.params = parsedFragment.params;
	dp.status = 'linked';
};
window.addEventListener('hashchange', () => {
	applyUrlFragment(parseUrlFragment());
	m.redraw();
	editor.focus();
});
/** @param {Project} proj */
const setProject = (proj, filePath = '') => {
	stopAll();
	devPatches.length = 0;
	editor.setProject(proj);
	proj.root.collapseDescendants();
	if (!goToPatchName(filePath)) goToPatchName(proj.getDefaultMain().path);
};
const staticUrl = new URL(window.tsStaticUrl, document.baseURI).href;
const projectUrl = new URL(window.tsProjectUrl, document.baseURI).href;
const serviceScope = new URL(window.tsServiceScope, document.baseURI).href;
const loadJson = async () => {
	let obj, resp = await fetch(projectUrl);
	try { obj = await resp.json(); }
	catch (error) { return alert('Project not found.'); }
	proj = Project.fromJsonObj(obj);
	await editor.loaded;
	const parsedFragment = parseUrlFragment();
	setProject(proj, parsedFragment.filePath);
	applyUrlFragment(parsedFragment);
};
loadJson();
const monacoUrl = staticUrl + 'editor-js/lib/monaco/min';
initService(serviceScope); // async

/** @param {ProjDir} dir */
const newFileInDir = dir => {
	const newFile = new ProjFile('new', '');
	dir.addChild(newFile);
	if (dir.collapsed) dir.collapsed = false;
	editingFile = newFile;
	newFile.renaming = true;
	editor.updateFiles();
};

const makeRenamer = ({obj, getValue, setValue}) => {
	/** @param {HTMLInputElement} input */
	const renameHandler = input => {
		if (!obj.renaming || document.activeElement === input)
			return;
		input.value = getValue();
		input.focus();
		if (input.value.includes('/') && input.value.includes('/')) {
			input.setSelectionRange(
				input.value.lastIndexOf('/') + 1,
				input.value.lastIndexOf('.')
			);
		} else {
			input.setSelectionRange(0, input.value.length);
		}
	};
	return m('input.renamer', {
		class: (obj.renaming ? 'renaming' : ''),
		oncreate: vnode => renameHandler(vnode.dom),
		onupdate: vnode => renameHandler(vnode.dom),
		onblur: e => {
			setValue(e.target.value);
			obj.renaming = false;
		},
		onkeyup: e => {
			if (e.keyCode === 13) { // enter
				e.target.blur(); // in case there's no editor
				editor.focus();
			} else if (e.keyCode === 27) { // esc
				e.target.value = getValue();
				e.target.blur(); // in case there's no editor
				editor.focus();
			}
		}
	});
};

/** @param {ProjFile} f */
const decorators = f => {
	const ret = [...Array(f.numAncestors)].map(_ => m('.parent_bar'));
	if (!f.isDir) return ret;
	ret.push(m(
		f.collapsed ? '.collapser.closed' : '.collapser.open',
		{onclick: () => {
			f.collapsed = !f.collapsed;
		}}
	));
	return ret;
};

/** @param {ProjFile} f */
const fileButtons = f => {
	const ret = [m('.filebtn.delete', {
		onclick: () => {
			f.remove();
			editor.updateFiles();
			editor.focus();
		}
	})];
	if (!f.isDir) return ret;
	ret.push(m('.filebtn.add', {
		onclick: () => newFileInDir(f)
	}));
	return ret;
};

/** @param {ProjFile} f */
const makeFileItem = f => m(
	'.file_item', {
		key: f.id, 
		class: (f === editingFile ? 'editing ' : ''),
		style: { gridTemplateColumns: `repeat(${decorators(f).length}, 1rem) 1fr` }
	}, [
		...decorators(f),
		m('.path', {
			onclick: () => {
				if (f.isDir) {
					f.collapsed = !f.collapsed;
				} else {
					editingFile = f;
				}
				editor.focus();
			},
			ondblclick: () => {
				f.renaming = true;
			}
		}, f.name ?? m.trust('&nbsp;')),
		...fileButtons(f),
		makeRenamer({
			getValue: () => f.path,
			setValue: v => {
				proj.setFilePath(f, v);
				window.setTimeout(() => {
					editor.updateFiles();
					editor.focus();
				}, 50);
			},
			obj: f
		})
	]
);

const FileList = {
	view: () => [
		[...proj.files].filter(f => !f.hasCollapsedAncestor).map(makeFileItem),
		m('.filebtn.add', {
			onclick: () => newFileInDir(proj.root)
		})
	]
};

const CodeContainer = {
	view: () => m('.code'),
	oncreate: vnode => editor.load(monacoUrl, vnode.dom),
	onupdate: () => editor.switchToFile(editingFile.id)
};

const TopLinks = {
	view: () => [
		m('.toplink.proj_name', {
			ondblclick: () => { proj.renaming = true; }
		}, [
			proj.name,
			makeRenamer({
				getValue: () => proj.name,
				setValue: v => {
					proj.name = v;
					editor.focus();
				},
				obj: proj
			})
		]),
		m('.toplink', {
			onclick: async () => {
				proj = await fsOpen();
				setProject(proj);
			}
		}, 'load'),
		m(canSave() ? '.toplink' : '.toplink.disabled', {
			onclick: async () => {
				await fsSave(proj);
				editor.focus();
			}
		}, 'save'),
		m('.toplink', {
			onclick: async () => {
				await fsSaveAs(proj);
				editor.focus();
			}
		}, 'as')
	]
};

let experimentalWarning = `Live compilation and playback is an experimental feature.

Open your browser's Javascript console (F12) to see compilation output.`;
if (window.location.host.includes('localhost')) experimentalWarning = undefined;

const viewPatches = () => devPatches.filter(dp => dp.status === 'playing' || dp.params.length);

const macroRec = () => m('.tool.macro', { onclick: () => macros.rec(editingFile) }, 'm-rec');
const macroPlay = () => m('.tool.macro', { onclick: () => macros.play(editingFile) }, 'm-play');
const macroPause = () => m('.tool.macro', { onclick: () => macros.pause() }, 'm-pause');
const macroResume = () => m('.tool.macro', { onclick: () => macros.resume() }, 'm-resume');
const macroStop = () => m('.tool.macro', { onclick: () => macros.stop() }, 'm-stop');
const macroRecing = () => m('.tool.status', 'recording');
const macroPlaying = () => m('.tool.status', 'playing');

const macroTools = () => {
	const editingMacro = editingFile.name.endsWith('.tmac');
	switch(macroStatus()) {
		case 'stopped': return editingMacro ? [macroRec(), macroPlay()] : [];
		case 'playing': return [macroPlaying(), macroPause(), macroStop()];
		case 'recording': return [macroRecing(), macroPause(), macroStop()];
		case 'playing paused': return [macroPlaying(), macroResume(), macroStop()];
		case 'recording paused': return [macroRecing(), macroResume(), macroStop()];
	}
};

const Tools = {
	view: () => [
		m('.tool', {
			onclick: () => {
				if (experimentalWarning) alert(experimentalWarning);
				playCurrent();
				editor.focus();
			}
		}, 'play'),
		m('.tool', {
			onclick: () => {
				stopAll();
				editor.focus();
			}
		}, 'stop'),
		m('.tool_menu', [
			m('.tool', '•••'),
			m('.tool', {
				onclick: () => {
					playCurrent({ override: false });
					editor.focus();
				}
			}, 'play multi'),
			m('.tool', {
				onclick: () => {
					showParams();
					editor.focus();
				}
			}, 'show params'),
		]),
		...macroTools(),
		...(viewPatches().length ? [
			m('.tool.bottom', {
				onclick: () => {
					minimized = !minimized;
					editor.focus();
				}
			}, minimized ? '🠥' : '🠧')
		] : [])
	]
};

/** @param {import('./devPlayer.js').DevPatch} dp */
const patchStopper = dp => {
	if (dp.status === 'playing') {
		return m('', {
			onclick: async () => {
				await dp.stop();
				macros.recEvent({ type: 'stop' }, dp);
				m.redraw();
			},
			style: { display: 'inline', fontWeight: 600 }
		}, '[stop] ');
	} else {
		return m('', {
			onclick: async () => {
				if (experimentalWarning) alert(experimentalWarning);
				experimentalWarning = undefined;
				macros.recEvent({ type: 'start' }, dp);
				editor.updateFiles();
				await dp.play();
				m.redraw();
			},
			style: { display: 'inline', fontWeight: 600 }
		}, '[play] ');
	}
};

/** @param {import('./devPlayer.js').DevPatch} dp */
const patchClearer = dp => {
	if (dp.params.length) {
		return [m('', {
			onclick: () => { dp.params.length = 0; },
			style: { display: 'inline', fontWeight: 600 }
		}, '[clear] ')];
	} else {
		return [];
	}
};

const applyParamText = (dp, par) => {
	try { par.val = parseParamStr(par.valStr); }
	catch { console.error('Could not parse param string: '+par.valStr); }
	if (dp.status === 'playing') {
		dp.patch.setParam(par.name, par.val);
		macros.recEvent({ type: 'tweak', params: [par] }, dp);
	}
};

/** @param {import('./devPlayer.js').DevPatch} dp */
const paramTextInput = (dp, par) => [
	m('input[type="text"]', {
		value: par.valStr,
		onkeydown(e) { if (e.key === 'Enter') applyParamText(dp, par); },
		// input.value gets updated between onkeydown and oninput...
		oninput(e) { par.valStr = e.target.value; },
		onblur() { applyParamText(dp, par); }
	}
)];

/** @param {import('./devPlayer.js').DevPatch} dp */
const paramSlider = (dp, par) => [
	m('input[type="range"]', {
		min: par.min,
		max: par.max,
		step: (par.max - par.min)/1000,
		value: par.val,
		oninput(e) { 
			par.val = e.target.value;
			if (dp.status === 'playing') {
				dp.patch.setParam(par.name, par.val);
				macros.recEvent({ type: 'tweak', params: [par] }, dp);
			}
		}
	}
)];

/** @param {import('./devPlayer.js').DevPatch} dp */
const paramInput = (dp, par) => {
	if (dp.status === 'linked') return [];
	if (par.valStr) return paramTextInput(dp, par);
	return paramSlider(dp, par);
};

const paramLabel = (dp, par) => {
	let ret = par.name + ': ';
	if (dp.status === 'linked') return ret + par.valStr;
	if (par.valStr) return ret;
	return ret + Math.round(par.val*1000)/1000;
};

/** @param {import('./devPlayer.js').DevPatch} dp */
const ParamsPatch = dp => [
	m('.params_title', [
		dp.name,
		m('br'),
		patchStopper(dp),
		...patchClearer(dp),
	]),
	...dp.params.map(par =>
		m('.param', [
			m('', [
				m('', {
					onclick: () => dp.params.splice(dp.params.indexOf(par), 1),
					style: { display: 'inline' }
				}, '[x] '),
				paramLabel(dp, par)
			]),
			...paramInput(dp, par)
		])
	)
];

const ParamsCorner = {
	view: () => {
		if (minimized) return [];
		return viewPatches().map(devPatch => m('.params_patch', ParamsPatch(devPatch)));
	}
};

const Layout = {
	view: () => [
		m('.layout', [
			m('input.collapser', { id: 'collapser', type: 'checkbox' }),
			m('label.collapser', { for: 'collapser' }),
			m('.project_pane', [
				m('.project_head', m(TopLinks)),
				m('.project_files', m(FileList)),
			]),
			m('.code_pane', m(CodeContainer)),
			m('.tool_pane', m(Tools))
		]),
		m('.params_corner', m(ParamsCorner)),
	]
};

m.mount(document.body, Layout);
