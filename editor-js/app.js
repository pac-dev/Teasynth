import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { ProjDir, Project, ProjFile } from '../core/project.js';
import { initService, devPlay, devStop, devTracks } from './devPlayer.js';
import { fsOpen, fsSave, fsSaveAs, canSave } from './fsa.js';

let proj = new Project('Empty project');
proj.root.addChild(new ProjFile('main.js', ''));
let editingFile = proj.getDefaultMain();
let lastMain = editingFile;
const playCurrent = async () => {
	let main = editingFile.closestMain;
	if (!main) main = lastMain;
	if (!proj.includes(main)) throw new Error('No main file to play.');
	lastMain = main;
	await devPlay(proj, main);
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
		let [name, val] = str.split('=');
		val = Function(`"use strict"; return parseFloat(${val})`)();
		return { name, val };
	});
	return ret;
};
const applyUrlFragment = parsedFragment => {
	goToFilePath(parsedFragment.filePath);
	const main = editingFile.closestMain;
	const trackName = main.parent.name;
	let dt = devTracks.find(t => t.name === trackName);
	if (!dt) {
		dt = { main, name: trackName, params: [], status: 'stopped' };
		devTracks.push(dt);
	}
	for (let { name, val } of parsedFragment.params) {
		const old = dt.params.find(p => p.name === name);
		if (old && (val < old.min || val > old.max)) alert('URL param out of range: ' + name);
		else if (old) old.val = val;
		else dt.params.push({ name, val, min: Number.MIN_VALUE, max: Number.MAX_VALUE });
		if (dt.status === 'playing') dt.track.setParam(name, val);
	}
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

const Tools = {
	view: () => [
		m('.tool', {
			onclick: () => {
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

/** @param {import('./devPlayer.js').DevTrack} dt */
const paramSlider = (dt, par) => {
	if (par.min !== Number.MIN_VALUE && par.max !== Number.MAX_VALUE) {
		return [m('input[type="range"]', {
			min: par.min,
			max: par.max,
			step: (par.max - par.min)/1000,
			value: par.val,
			oninput(e) { 
				par.val = e.target.value;
				if (dt.status === 'playing') dt.track.setParam(par.name, par.val);
			}
		})];
	} else {
		return [];
	}
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
				` ${par.name}: ${Math.round(par.val*1000)/1000}`,
			]),
			...paramSlider(dt, par)
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
			m('.project_pane', [
				m('.project_head', m(TopLinks)),
				m('.project_files', m(FileList)),
			]),
			m('.code_pane', m(CodeContainer)),
			m('.tool_pane', m(Tools))
		]),
		m('.params_corner', m(ParamsCorner))
	]
};

m.mount(document.body, Layout);
