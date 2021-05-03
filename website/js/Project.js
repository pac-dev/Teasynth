// presumably this module could be used in non-browser contexts
// so let's not use Web APIs in here

const fileId = (() => {
	let count = 100; // fail fast if array index is used instead of id
	return () => 'id'+(++count);
})();

export class ProjFile {
	constructor(name, content) {
		/** @type {String} */
		this._name = name;
		/** @type {String} */
		this.content = content;
		/** @type {ProjDir} */
		this._parent;
		this.id = fileId();
		this.renaming = false;
		this.editing = false;
	}
	get name() { return this._name; }
	set name(v) {
		this._name = v;
		if (this.parent) this.parent.sortChildren();
	}
	get parent() { return this._parent; }
	get lineage() {
		const lineage = [];
		let ancestor = this.parent;
		while(ancestor?.parent) {
			lineage.push(ancestor);
			ancestor = ancestor.parent;
		}
		return lineage.reverse();
	}
	get path() {
		return [...this.lineage, this].map(f => f.name).join('/');
	}
	get numAncestors() {
		return this.lineage.length;
	}
	get hasCollapsedAncestor() {
		return this.lineage.some(f => f.collapsed);
	}
	remove() {
		if (!this.parent) throw new Error('Tried removing orphan '+this.name);
		this.parent.removeChild(this);
	}
}

export class ProjDir extends ProjFile {
	constructor(name) {
		super(name, '', true);
		/** @type {Array.<ProjFile>} */
		this._children = [];
		this.collapsed = false;
	}
	/**
	 * @param {ProjFile} file
	 * @returns {ProjFile} - the added file
	 */
	addChild(file) {
		if (file.parent) {
			throw new Error(`Tried re-childing ${file.name} from ${file.parent.name} to ${this.name}!`);
		}
		if (this._children.some(c => c.name === file.name)) {
			throw new Error(`File ${file.name} already exist!`);
		}
		file._parent = this;
		this._children.push(file);
		this.sortChildren();
		return file;
	}
	/**
	 * @param {ProjFile} file
	 * @returns {ProjFile} - the removed file
	 */
	removeChild(file) {
		if (!this._children.includes(file)) {
			throw new Error(`Tried removing ${file.name} from wrong parent ${this.name}!`);
		}
		file._parent = undefined;
		this._children = this._children.filter(child => child != file);
		return file;
	}
	sortChildren() {
		this._children.sort((a, b) => a.path.localeCompare(b.path));
	}
	/** @param {String} name */
	findChild(name) {
		return this._children.find(f => f.name === name);
	}
	get children() {
		return this._children.values();
	}
	/** @returns {IterableIterator<ProjFile>} */
	get descendants() {
		const self = this;
		return {*[Symbol.iterator]() {
			/** @param {ProjFile} file */
			function* visit(file) {
				yield file;
				if (!(file instanceof ProjDir)) return;
				for (let child of file.children) {
					yield* visit(child);
				}
			}
			for (let child of self.children) {
				yield* visit(child);
			}
		}};
	}
}

export class Project {
	constructor(name) {
		this.root = new ProjDir('root');
		this.name = name;
		this.renaming = false;
	}
	/**
	 * @param {ProjFile} file
	 * @param {String} path
	 */
	changeFilePath(file, path) {
		const components = path.split('/');
		file.name = components.pop();
		let parent = this.root;
		for (let comp of components) {
			if (parent.findChild(comp)) {
				parent = parent.findChild(comp);
			} else {
				parent = parent.addChild(new ProjDir(comp));
			}
			if (!(parent instanceof ProjDir)) {
				throw new Error(`Tried adding ${path}, but it clobbers non-directory ${parent.path}!`)
			}
		}
		file.remove();
		parent.addChild(file);
		return file;
	}
	findById(id) {
		for (let file of this.root.descendants) {
			if (file.id === id) return file;
		}
		throw new Error('Search for missing ID: '+id);
	}
	getStartingFile() {
		let first;
		for (let file of this.files) {
			if (file instanceof ProjDir) continue;
			if (!first) first = file;
			if (file.name === 'main.js') return file;
		}
		return first;
	}
	/** @returns {IterableIterator<ProjFile>} */
	get files() {
		return this.root.descendants;
	}
}