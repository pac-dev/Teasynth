import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { ProjDir, Project, ProjFile } from './Project.js';
import { initService, play, stop } from './player.js';
import { fsOpen, fsSave, fsSaveAs, canSave } from './fsa.js';

let proj = new Project('Untitled Project');
proj.root.addChild(new ProjFile('main.js', "console.log('running in bread')"));
let editingFile = proj.getDefaultMain();
let lastMain = editingFile;
const playProj = () => {
	let main = editingFile.closestMain;
	if (!main) main = lastMain;
	if (!proj.includes(main)) throw new Error('No main file to play.');
	lastMain = main;
	play(proj, main);
};
const editor = new CodeEditor(proj, editingFile.id);
window.getProj = () => proj;
window.getEditor = () => editor;
editor.addShortcut('Alt+KEY_1', 'Play', () => playProj());
editor.addShortcut('Alt+KEY_2', 'Stop', () => stop());
editor.addShortcut('Alt+KEY_3', 'Previous File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(files.length+currentIdx-1)%files.length];
	m.redraw();
});
editor.addShortcut('Alt+KEY_4', 'Next File', () => {
	const files = [...proj.files].filter(f => !f.isDir);
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(currentIdx+1)%files.length];
	m.redraw();
});

const url = window.location.href;
const urlBase = url.substring(0, url.lastIndexOf('/')+1);
const monacoURL = urlBase+'js/lib/monaco/min';
initService(urlBase); // async

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
				if (!f.isDir) editingFile = f;
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
				proj.changeFilePath(f, v);
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
	oncreate: vnode => editor.load(monacoURL, vnode.dom),
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
				editor.setProject(proj);
				editingFile = proj.getDefaultMain();
				proj.root.collapseDescendants();
				m.redraw();
				editor.focus();
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
				playProj();
				editor.focus();
			}
		}, 'play'),
		m('.tool', {
			onclick: () => {
				stop();
				editor.focus();
			}
		}, 'stop')
	]
};

const Layout = {
	view: () => m('.layout', [
		m('.project_pane', [
			m('.project_head', m(TopLinks)),
			m('.project_files', m(FileList)),
		]),
		m('.code_pane', m(CodeContainer)),
		m('.tool_pane', m(Tools))
	])
};

m.mount(document.body, Layout);
