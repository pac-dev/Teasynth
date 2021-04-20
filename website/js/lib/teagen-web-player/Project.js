// presumably this module could be used in non-browser contexts
// so let's not use Web APIs in here

const fileId = (() => {
	let count = 100; // fail fast if array index is used instead of id
	return () => ++count;
})();

export class ProjFile {
	constructor(path, content) {
		this.path = path;
		this.content = content;
		this.id = fileId();
		this.renaming = false;
		this.editing = false;
	}
}

export class Project {
	constructor(name) {
		/** @type {Array.<ProjFile>} */
		this.files = [];
		this.name = name;
		this.renaming = false;
	}
	addFile(path, content) {
		const f = new ProjFile(path, content);
		this.files.push(f);
		return f;
	}
	moveFile(id, path) {
		const file = this.files.find(f => f.id === id);
		if (file.path === path) return false;
		file.path = path;
		return true
	}
	getContentByPath(path) {
		const file = this.files.find(f => f.path === path);
		return file.content;
	}
	setContent(id, content) {
		const file = this.files.find(f => f.id === id);
		if (file.content === content) return false;
		file.content = content;
		return true;
	}
	delete(id) {
		const idx = this.files.findIndex(f => f.id === id);
		this.files.splice(idx, 1);
	}
	/** @return {Array.<ProjFile>} */
	getFiles() {
		return this.files;
	}
}