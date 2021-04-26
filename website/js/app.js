import { CodeEditor } from './codeEditor.js';
import { m } from './lib/mithrilModule.js';
import { Project } from './lib/teagen-web-player/Project.js';
import { proj2zip, zip2proj, play, stop, initService } from './lib/teagen-web-player/player.js';

let proj = new Project('Untitled Project');
proj.addFile('main.js', "console.log('running in bread')");
proj.addFile('worklet.js', '// hello');
let editingId = proj.getFiles()[0].id;
const editor = new CodeEditor(proj);
editor.addShortcut('CtrlCmd+Enter', 'Play', () => play(proj));
editor.addShortcut('CtrlCmd+Space', 'Stop', () => stop());
editor.addShortcut('Alt+LeftArrow', 'Previous File', () => {
	const files = proj.getFiles();
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f.id == editingId);
	if (currentIdx === undefined) return;
	editingId = files[(files.length+currentIdx-1)%files.length].id;
	m.redraw();
});
editor.addShortcut('Alt+RightArrow', 'Next File', () => {
	const files = proj.getFiles();
	if (files.length < 2) return;
	let currentIdx = files.findIndex(f => f.id == editingId);
	if (currentIdx === undefined) return;
	editingId = files[(currentIdx+1)%files.length].id;
	m.redraw();
});

const url = window.location.href;
const urlBase = url.substring(0, url.lastIndexOf('/')+1);
const monacoURL = urlBase+'js/lib/monaco/min';
initService(urlBase); // async

const makeRenamer = ({obj, getValue, setValue}) => {
	const renameHandler = input => {
		if (!obj.renaming || document.activeElement === input)
			return;
		input.value = getValue();
		input.focus();
		input.setSelectionRange(0, input.value.lastIndexOf('.'));
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
				editor.focus();
			} else if (e.keyCode === 27) { // esc
				e.target.value = getValue();
				editor.focus();
			}
		}
	});
};

const makeFileItem = f => m(
	'.file_item', {key: f.id, class: (f.id === editingId ? 'editing ' : '')}, 
	[
		m('.path', {
			onclick: () => {
				editingId = f.id;
				editor.focus();
			},
			ondblclick: () => {
				f.renaming = true;
			}
		}, (f.path ? f.path : m.trust('&nbsp;'))),
		m('.delete', {
			onclick: () => {
				proj.delete(f.id);
				editor.removeFile(f.id);
			}
		}),
		makeRenamer({
			getValue: () => f.path,
			setValue: v => {
				if (proj.moveFile(f.id, v))
					window.setTimeout(() => {
						editor.updateFileName(f);
						editor.focus();
					}, 100);
				editor.focus();
			},
			obj: f
		})
	]
);

const FileList = {
	view: () => [
		proj.getFiles().map(makeFileItem),
		m('.add', {
			onclick: () => {
				const newFile = proj.addFile('', '');
				editor.addFile(newFile);
				editingId = newFile.id;
				newFile.renaming = true;
			}
		})
	]
};

const CodeContainer = {
	view: () => m('.code'),
	oncreate: vnode => editor.load(monacoURL, vnode.dom),
	onupdate: () => editor.switchToFile(editingId)
};

const TopLinks = {
	view: () => [
		m('.toplink', {
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
				editingId = proj.getFiles()[0].id;
				e.target.value = null;
				m.redraw();
			}
		})
	]
};

const Tools = {
	view: () => [
		m('.tool', {
			onclick: () => play(proj)
		}, 'play'),
		m('.tool', {
			onclick: () => stop()
		}, 'stop')
	]
};

const Layout = {
	view: () => m('.layout', [
		m('.top_pane', m(TopLinks)),
		m('.file_pane', m(FileList)),
		m('.code_pane', m(CodeContainer)),
		m('.tool_pane', m(Tools))
	])
};

m.mount(document.body, Layout);
