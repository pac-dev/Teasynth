// presumably this module could be used in non-browser contexts
// so let's not use Web APIs in here

const fileId = (() => {
	let count = 100; // fail fast if array index is used instead of id
	return () => ++count;
})();

export class ProjFile {
	constructor(path, content, isDir=false) {
		/** @type {String} */
		this.path = path;
		/** @type {String} */
		this.content = content;
		this.isDir = isDir;
		this.id = fileId();
		this.renaming = false;
		this.editing = false;
	}
	parentPath() {
		if (!this.path.includes('/')) return;
		return this.path.slice(0, path.lastIndexOf('/'));
	}
	numAncestors() {
		return (this.path.match(/\//g) || []).length;
	}
	fileName() {
		if (!this.path.includes('/')) return this.path;
		return this.path.slice(this.path.lastIndexOf('/')+1);
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
		this.createMissingAncestors(path);
		this.sortFiles();
		return f;
	}
	addDir(path) {
		const f = new ProjFile(path, '', true);
		this.files.push(f);
		this.createMissingAncestors(path);
		this.sortFiles();
	}
	moveFile(id, newPath) {
		if (this.getFileByPath(newPath)) return false;
		const file = this.files.find(f => f.id === id);
		const oldPath = file.path;
		if (oldPath === newPath) return false;
		file.path = newPath;
		this.createMissingAncestors(newPath);
		this.childrenOfPath(oldPath).forEach(child => {
			this.moveFile(child.id, newPath + child.path.substring(oldPath.length));
		});
		this.sortFiles();
		return true;
	}
	/**
	 * @param {ProjFile} file 
	 * @returns {Array.<ProjFile>}
	 */
	childrenOfPath(parentPath) {
		return this.files.filter(
			f => f.path.startsWith(parentPath+'/')
		);
	}
	sortFiles() {
		this.files.sort((a, b) => a.path.localeCompare(b.path));
	}
	/** @param {String} path */
	createMissingAncestors(path) {
		if (!path.includes('/')) return;
		const parent = path.slice(0, path.lastIndexOf('/'));
		if (!this.getFileByPath(parent)) this.addDir(parent);
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
	getFileByPath(path) {
		return this.files.find(f => f.path === path);
	}
	getContentByPath(path) {
		return this.getFileByPath(path).content;
	}
}