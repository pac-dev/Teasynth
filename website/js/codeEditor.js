import { loadScript } from "./network.js";
import { Project, ProjFile } from './lib/teagen-web-player/Project.js';

// always call model.setEOL immediately after model.setValue

export class CodeEditor {
	/** @param {Project} proj */
	constructor(proj) {
		this.ready = false;
		this.fileModels = {};
		this.fileStates = {};
		this.currentFileId = 0;
		this.shortcuts = [];
		this.setProject(proj);
	}
	/** @param {Project} proj */
	setProject(proj) {
		this.proj = proj;
		if (this.ready) this.loadedSetProject();
	}
	addShortcut(shortcut, label, run) {
		this.shortcuts.push([shortcut, label, run]);
		if (this.ready) this.loadedAddShortcut(shortcut, label, run);
	}
	loadedSetProject() {
		Object.keys(this.fileModels).forEach(k => this.removeFile(k));
		const files = this.proj.getFiles();
		files.forEach(f => this.addFile(f));
		this.switchToFile(files[0].id);
	}
	loadedAddShortcut(shortcut, label, run) {
		let key;
		const parts = shortcut.split('+');
		if (parts.length == 1)
			key = monaco.KeyCode[parts[1]];
		else if (parts.length == 2)
			key = monaco.KeyMod[parts[0]] | monaco.KeyCode[parts[1]];
		else
			throw new Error('Unsupported shortcut type.');
		this.editor.addAction({
			id: label.replaceAll(' ', '-'),
			label, keybindings: [key],
			// @param editor The editor instance is passed in as a convinience
			run
		});
	}
	/** @param {ProjFile} f */
	addFile(f) {
		const uri = monaco.Uri.file('/'+f.path);
		const model = monaco.editor.createModel(f.content, undefined, uri); // 'text/plain'
		model.setEOL(monaco.editor.EndOfLineSequence.LF);
		this.fileModels[f.id] = model;
		model.onDidChangeContent(() => {
			this.proj.setContent(f.id, model.getValue());
		});
	}
	switchToFile(id) {
		if (this.currentFileId === id) return;
		if (this.currentFileId)
			this.fileStates[this.currentFileId] = this.editor.saveViewState();
		this.editor.setModel(this.fileModels[id]);
		if (this.fileStates[id])
			this.editor.restoreViewState(this.fileStates[id]);
		this.currentFileId = id;
	}
	/** @param {ProjFile} f */
	updateFileName(f) {
		// https://github.com/Microsoft/monaco-editor/issues/926
		const isCurrentFile = this.currentFileId === f.id;
		if (isCurrentFile) this.currentFileId = 0;
		this.removeFile(f.id);
		this.addFile(f);
		if (isCurrentFile) this.switchToFile(f.id);
	}
	removeFile(id) {
		if (this.fileModels[id])
			this.fileModels[id].dispose();
		delete this.fileModels[id];
	}
	focus() { this.editor.focus(); }
	async load(url, domEle) {
		await loadScript(url + '/vs/loader.js');
		require.config({ paths: { 'vs': url + '/vs' }});
		window.MonacoEnvironment = { getWorkerUrl: () => proxy };
		const proxy = URL.createObjectURL(new Blob([`
			self.MonacoEnvironment = {
				baseUrl: '${url}/'
			};
			importScripts('${url}/vs/base/worker/workerMain.js');
		`], { type: 'text/javascript' }));
		require(["vs/editor/editor.main"], () => {
			this.editor = monaco.editor.create(domEle, {automaticLayout: true});
			this.ready = true;
			this.loadedSetProject();
			this.shortcuts.forEach(s => this.loadedAddShortcut(...s));
		});
	}
}