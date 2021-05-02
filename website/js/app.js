import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { ProjDir, Project, ProjFile } from './lib/teagen-web-player/Project.js';
import { proj2zip, zip2proj, play, stop, initService } from './lib/teagen-web-player/player.js';

let proj = new Project('Untitled Project');
window.tgProj = proj;
// proj.addFileByPath('main.js', "console.log('running in bread')");
// proj.addFileByPath('test/nah.js', '// hello');
// proj.addFileByPath('test/yah.js', '// hyello');
proj.root.addChild(new ProjFile('fa.js', "a console.log('running in bread')"));
proj.root.addChild(new ProjFile('fb.js', "b consol22e.log('running in bread')"));
proj.root.addChild(new ProjFile('fc.js', "c consol33e.log('running in bread')"));
const el = proj.root.addChild(new ProjDir('da'));
el.addChild(new ProjFile('dafa.js', "consol3d3e.log('running in bread')"));
el.addChild(new ProjFile('dafb.js', "consol3ggin bread')"));
const el2 = el.addChild(new ProjDir('za'));
el2.addChild(new ProjFile('zafa.js', "consol3d3e.log('running in bread')"));
el2.addChild(new ProjFile('zafb.js', "consol3ggin bread')"));
let editingFile = proj.getStartingFile();
const editor = new CodeEditor(proj, editingFile.id);
window.tgEditor = editor;
editor.addShortcut('Alt+KEY_1', 'Play', () => play(proj));
editor.addShortcut('Alt+KEY_2', 'Stop', () => stop());
editor.addShortcut('Alt+KEY_3', 'Previous File', () => {
	const files = [...proj.files].filter(f => !(f instanceof ProjDir));
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f == editingFile);
	if (currentIdx === undefined) return;
	editingFile = files[(files.length+currentIdx-1)%files.length];
	m.redraw();
});
editor.addShortcut('Alt+KEY_4', 'Next File', () => {
	const files = [...proj.files].filter(f => !(f instanceof ProjDir));
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
	if (!(f instanceof ProjDir)) return ret;
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
	if (!(f instanceof ProjDir)) return ret;
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
				if (!(f instanceof ProjDir)) editingFile = f;
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
			onclick: () => document.getElementById('load_input').click()
		}, 'load'),
		m('.toplink', {
			onclick: async () => {
				const blob = await proj2zip(proj);
				const fileURL = URL.createObjectURL(blob);
				const a = document.createElement('A');
				a.href = fileURL;
				a.download = proj.name + '.zip';
				a.click();
				editor.focus();
			}
		}, 'save'),
		m('input', {
			type: 'file',
			id: 'load_input',
			onchange: async e => {
				const file = e.target.files[0];
				if (!file) return;
				proj = await zip2proj(file);
				editor.setProject(proj);
				editingFile = proj.getStartingFile();
				e.target.value = null;
				m.redraw();
				editor.focus();
			}
		})
	]
};

const Tools = {
	view: () => [
		m('.tool', {
			onclick: () => {
				play(proj);
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
