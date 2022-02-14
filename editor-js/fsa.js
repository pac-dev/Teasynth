import { Project, ProjFile, ProjDir } from '../core/project.js';

let currentDirHandle;

/** @param {File} file */
export const fsOpen = async () => {
	currentDirHandle = await window.showDirectoryPicker();
	const visit = async (projDir, fsDir) => {
		for await (const entry of fsDir.values()) {
			if (entry.kind === 'file') {
				const file = await entry.getFile();
				const content = await file.text();
				projDir.addChild(new ProjFile(entry.name, content));
			} else if (entry.kind === 'directory') {
				await visit(projDir.addChild(new ProjDir(entry.name)), entry);
			} else {
				console.log('unknown fs entry kind: '+kind);
			}
		}
	}
	const proj = new Project(currentDirHandle.name);
	await visit(proj.root, currentDirHandle);
	return proj;
};

const deleteEntry = (fsDir, entry) => {
	if (entry.kind === 'directory') {
		fsDir.removeEntry(entry.name, { recursive: true });
	} else {
		fsDir.removeEntry(entry.name);
	}
};

export const fsSave = async proj => {
	if (!currentDirHandle) throw new Error('Nowhere to save!');
	console.log('Saving...')
	if ((await currentDirHandle.queryPermission({mode: 'readwrite'})) !== 'granted') {
		if ((await currentDirHandle.requestPermission({mode: 'readwrite'})) !== 'granted') {
			throw new Error("Couldn't get permission to write to "+currentDirHandle.name);
		}
	}
	let numCreated = 0, numDeleted = 0;
	/** @param {ProjDir} projParent */
	const visit = async (projParent, fsDir) => {
		let projChildren = [...projParent.children];
		for await (const fsEntry of fsDir.values()) {
			const projChild = projChildren.find(f => f.name === fsEntry.name);
			if (!projChild) {
				// FS file not present in VFS: delete it
				numDeleted++;
				deleteEntry(fsDir, fsEntry);
				continue;
			}
			if (projChild.isDir !== (fsEntry.kind === 'directory')) {
				// wrong type (directory / non-directory): delete it and keep it in missing files
				numDeleted++;
				deleteEntry(fsDir, fsEntry);
				continue;
			}
			if (fsEntry.kind === 'directory') {
				// directory with correct name: iterate it and remove it from missing files
				await visit(projChild, fsEntry);
				projChildren = projChildren.filter(f => f !== projChild);
			} else if (fsEntry.kind === 'file') {
				// file with correct name: check content
				const file = await fsEntry.getFile();
				const content = await file.text();
				if (content === projChild.content) {
					// file content correct: remove it from missing files
					projChildren = projChildren.filter(f => f !== projChild);
				} else {
					// file content changed: delete it and keep it in missing files
					numDeleted++;
					deleteEntry(fsDir, fsEntry);
				}
			} else {
				console.log('unknown fs entry kind: '+kind);
			}
		}
		// projChildren now only contains missing files
		for (const projChild of projChildren) {
			if (projChild.isDir) {
				// Missing directory: create and iterate it
				numCreated++;
				const newFsDir = await fsDir.getDirectoryHandle(projChild.name, {create: true});
				await visit(projChild, newFsDir);
			} else {
				// Missing non-directory: create and write to it
				numCreated++;
				const newFsEntry = await fsDir.getFileHandle(projChild.name, {create: true});
				const writable = await newFsEntry.createWritable();
				await writable.write(projChild.content);
				await writable.close();
			}
		}
	}
	await visit(proj.root, currentDirHandle);
	console.log(`Save successful. Deleted: ${numDeleted}, created: ${numCreated}`);
};

export const fsSaveAs = async proj => {
	const parentDirHandle = await window.showDirectoryPicker();
	if ((await parentDirHandle.queryPermission({mode: 'readwrite'})) !== 'granted') {
		if ((await parentDirHandle.requestPermission({mode: 'readwrite'})) !== 'granted') {
			throw new Error("Couldn't get permission to write to "+parentDirHandle.name);
		}
	}
	currentDirHandle = await parentDirHandle.getDirectoryHandle(proj.name, {create: true});
	fsSave(proj);
};

export const canSave = () => currentDirHandle;