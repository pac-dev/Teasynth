import { loadScript } from "./network.js";
import { Project, ProjFile } from '../core/project.js';
import { registerSporth } from './sporthEditor.js';
import { getFaustProviders } from './lib/faust/faustlang.js';

// always call model.setEOL immediately after model.setValue

/** @param {ProjFile} f */
const createModel = f => {
	const uri = monaco.Uri.file('/'+f.path);
	let lang;
	if (f.content.length > 100000) lang = 'text/plain';
	else if (f.path.endsWith('.js')) lang = 'javascript';
	else if (f.path.endsWith('.sp')) lang = 'sporth';
	else if (f.path.endsWith('.dsp')) lang = 'faust';
	const model = monaco.editor.createModel(f.content, lang, uri);
	model.updateOptions({ insertSpaces: false });
	model.setEOL(monaco.editor.EndOfLineSequence.LF);
	model.onDidChangeContent(() => {
		f.content = model.getValue();
	});
	return model;
}

export class CodeEditor {
	/** @param {Project} proj */
	constructor(proj, currentFileId) {
		this.ready = false;
		this.fileModels = {};
		this.fileStates = {};
		this.currentFileId = currentFileId;
		this.shortcuts = [];
		this.setProject(proj);
		const that = this;
		this.loaded = new Promise(resolve => {
			that.onLoaded = resolve;
		});
	}
	/** @param {Project} proj */
	setProject(proj) {
		this.proj = proj;
		if (this.ready) this.updateFiles();
	}
	/**
	 * refer to https://microsoft.github.io/monaco-editor/api/enums/monaco.keycode.html
	 * and https://microsoft.github.io/monaco-editor/api/classes/monaco.keymod.html
	 */
	addShortcut(shortcut, label, run) {
		this.shortcuts.push([shortcut, label, run]);
		if (this.ready) this.loadedAddShortcut(shortcut, label, run);
	}
	updateFiles() {
		const projFiles = [...this.proj.files].filter(f => !f.isDir);
		const projIds = projFiles.map(f => f.id);
		for (let file of projFiles) {
			const oldModel = this.fileModels[file.id];
			if (oldModel) {
				if (oldModel.getValue() !== file.content) {
					oldModel.setValue(file.content);
				}
				if (oldModel.uri.path !== '/'+file.path) {
					//console.log(`monaco: path change: ${oldModel.uri.path} -> /${file.path}`);
					this.fileModels[file.id].dispose();
					this.fileModels[file.id] = createModel(file);
				}
			} else {
				this.fileModels[file.id] = createModel(file);
			}
		}
		for (const id of Object.keys(this.fileModels)) {
			if (!projIds.includes(id)) {
				this.fileModels[id].dispose();
				delete this.fileModels[id];
				delete this.fileStates[id];
			}
		}
		if (!this.editor.getModel() || this.editor.getModel() !== this.fileModels[this.currentFileId]) {
			if (this.fileModels[this.currentFileId]) {
				//console.log('monaco: current model recreated, switching to new model');
				const id = this.currentFileId;
				this.currentFileId = 0;
				this.switchToFile(id);
			} else {
				//console.log('monaco: file for current model disappeared');
			}
		}
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
			// @param editor The editor instance is passed in as a convenience
			run
		});
	}
	switchToFile(id) {
		if (this.currentFileId === id) return;
		if (this.currentFileId)
			this.fileStates[this.currentFileId] = this.editor.saveViewState();
		this.editor.setModel(this.fileModels[id]);
		if (this.fileStates[id]) {
			// should work even if the model has been recreated
			this.editor.restoreViewState(this.fileStates[id]);
		}
		this.currentFileId = id;
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
			this.editor = monaco.editor.create(domEle, {automaticLayout: true},{
				storageService: {
					get() {},
					remove() { },
					getBoolean(key) {
						if (key === "expandSuggestionDocs")
							return true;
			
						return false;
					},
					getNumber(key) {
						return 0;
					},
					store() {},
					onWillSaveState() {},
					onDidChangeStorage() {}
				}
			});
			registerSporth();
			monaco.languages.register({ id: 'faust' });
			getFaustProviders().then(providers => {
				const {hoverProvider, tokensProvider, completionItemProvider} = providers;
				monaco.languages.setMonarchTokensProvider('faust', tokensProvider);
				monaco.languages.registerCompletionItemProvider('faust', completionItemProvider);
				monaco.languages.registerHoverProvider('faust', hoverProvider);
			});
			this.ready = true;
			this.updateFiles();
			this.shortcuts.forEach(s => this.loadedAddShortcut(...s));
			this.onLoaded();
		});
	}
}