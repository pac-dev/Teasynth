import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { ProjDir, Project, ProjFile } from '../core/project.js';
import { initService, devPlay, devStop, devTracks, parseParamStr } from './devPlayer.js';
import { fsOpen, fsSave, fsSaveAs, canSave } from './fsa.js';

let proj = new Project('Empty project');
proj.root.addChild(new ProjFile('main.js', ''));
let editingFile = proj.getDefaultMain();
let lastMain = editingFile;
const playCurrent = async ({multi=false}={}) => {
	experimentalWarning = undefined;
	let main = editingFile.closestMain;
	if (!main) main = lastMain;
	if (!proj.includes(main)) throw new Error('No main file to play.');
	lastMain = main;
	await devPlay(proj, main, multi);
	m.redraw();
};
const stopAll = async () => {
	for (let dt of devTracks) {
		if (dt.status !== 'playing') continue;
		await devStop(dt);
	}
	m.redraw();
};
const editor = new CodeEditor(proj, editingFile.id);
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
editor.addShortcut('Alt+Digit1', 'Play', () => playCurrent());
editor.addShortcut('Alt+Shift+Digit1', 'Play Multi', () => playCurrent({ multi: true }));
editor.addShortcut('Alt+Digit2', 'Stop', () => stopAll());
editor.addShortcut('Alt+Digit3', 'Previous File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(files.length+currentIdx-1)%files.length];
	m.redraw();
});
editor.addShortcut('Alt+Digit4', 'Next File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(currentIdx+1)%files.length];
	m.redraw();
});
const goToFilePath = path => {
	const file = proj.findByPath(path);
	if (!file) return false;
	if (file.isDir) {
		const main = file.findChild('main.js');
		if (main) editingFile = main;
		else return false;
	} else {
		editingFile = file;
	}
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
	goToFilePath(parsedFragment.filePath);
	const main = editingFile.closestMain;
	const trackName = main.parent.name;
	let oldi = devTracks.findIndex(t => t.name === trackName);
	if (oldi !== -1) {
		if (devTracks[oldi].track) devTracks[oldi].track.stop();
		devTracks.splice(oldi, 1);
	}
	const dt = { main, name: trackName, params: parsedFragment.params, status: 'proposed' };
	devTracks.push(dt);
};
window.addEventListener('hashchange', () => {
	applyUrlFragment(parseUrlFragment());
	m.redraw();
	editor.focus();
});
/** @param {Project} proj */
const setProject = (proj, filePath = '') => {
	stopAll();
	devTracks.length = 0;
	editor.setProject(proj);
	proj.root.collapseDescendants();
	if (!goToFilePath(filePath)) goToFilePath(proj.getDefaultMain().path);
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
	const renameHandler = input => {
		if (!obj.renaming || document.activeElement === input)
			return;
		input.value = getValue();
		input.focus();
		input.setSelectionRange(
			input.value.lastIndexOf('/') + 1,
			input.value.lastIndexOf('.')
		);
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
					playCurrent({ multi: true });
					editor.focus();
				}
			}, 'play multi'),
		])
	]
};

/** @param {import('./devPlayer.js').DevTrack} dt */
const trackStopper = dt => {
	if (dt.status === 'playing') {
		return m('', {
			onclick: async () => {
				await devStop(dt);
				m.redraw();
			},
			style: { display: 'inline', fontWeight: 600 }
		}, '[stop] ');
	} else {
		return m('', {
			onclick: async () => {
				if (experimentalWarning) alert(experimentalWarning);
				experimentalWarning = undefined;
				await devPlay(proj, dt.main);
				m.redraw();
			},
			style: { display: 'inline', fontWeight: 600 }
		}, '[play] ');
	}
};

/** @param {import('./devPlayer.js').DevTrack} dt */
const trackClearer = dt => {
	if (dt.params.length) {
		return [m('', {
			onclick: () => { dt.params.length = 0; },
			style: { display: 'inline', fontWeight: 600 }
		}, '[clear] ')];
	} else {
		return [];
	}
};

const applyParamText = (dt, par) => {
	try { par.val = parseParamStr(par.valStr); }
	catch { console.error('Could not parse param string: '+par.valStr); }
	if (dt.status === 'playing') dt.track.setParam(par.name, par.val);
};

/** @param {import('./devPlayer.js').DevTrack} dt */
const paramTextInput = (dt, par) => [
	m('input[type="text"]', {
		value: par.valStr,
		onkeydown(e) { if (e.key === 'Enter') applyParamText(dt, par); },
		// input.value gets updated between onkeydown and oninput...
		oninput(e) { par.valStr = e.target.value; },
		onblur() { applyParamText(dt, par); }
	}
)];

/** @param {import('./devPlayer.js').DevTrack} dt */
const paramSlider = (dt, par) => [
	m('input[type="range"]', {
		min: par.min,
		max: par.max,
		step: (par.max - par.min)/1000,
		value: par.val,
		oninput(e) { 
			par.val = e.target.value;
			if (dt.status === 'playing') dt.track.setParam(par.name, par.val);
		}
	}
)];

/** @param {import('./devPlayer.js').DevTrack} dt */
const paramInput = (dt, par) => {
	if (dt.status === 'proposed') return [];
	if (par.valStr) return paramTextInput(dt, par);
	return paramSlider(dt, par);
};

const paramLabel = (dt, par) => {
	let ret = par.name + ': ';
	if (dt.status === 'proposed') return ret + par.valStr;
	if (par.valStr) return ret;
	return ret + Math.round(par.val*1000)/1000;
};

/** @param {import('./devPlayer.js').DevTrack} dt */
const ParamsTrack = dt => [
	m('.params_title', [
		dt.name,
		m('br'),
		trackStopper(dt),
		...trackClearer(dt),
	]),
	...dt.params.map(par =>
		m('.param', [
			m('', [
				m('', {
					onclick: () => dt.params.splice(dt.params.indexOf(par), 1),
					style: { display: 'inline' }
				}, '[x] '),
				paramLabel(dt, par)
			]),
			...paramInput(dt, par)
		])
	)
];

const ParamsCorner = {
	view: () => devTracks
		.filter(dt => dt.status === 'playing' || dt.params.length)
		.map(devTrack => m('.params_track', ParamsTrack(devTrack)))
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
