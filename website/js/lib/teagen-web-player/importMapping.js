/**
 * Used to convert original import paths into canonical project paths.
 * @param {String} base Project path of the file containing the import statement
 * @param {String} relative Original import statement
 */
const absolute = (base, relative) => {
	const stack = base.split('/');
	const parts = relative.split('/');
	stack.pop(); // remove current file name
	for (let i = 0; i < parts.length; i++) {
		if (parts[i] == '.')
			continue;
		if (parts[i] == '..')
			stack.pop();
		else
			stack.push(parts[i]);
	}
	return stack.join('/');
}

/**
 * @param {String} path 
 * @param {String} code 
 * @param {Number} startAt
 */
export const nextImportStatement = (importer, code, startAt) => {
	const importRegex = new RegExp(/(import(?:["'\s]*[\w*${}\n\r\t, ]+from\s*)?["'\s]["'\s])(.*[@\w_-]+)["'\s].*;$/, 'mg');
	importRegex.lastIndex = startAt;
	const match = importRegex.exec(code);
	if (!match) return;
	let imported = match[2];
	if (imported.startsWith('.'))
		imported = absolute(importer, imported);
	else if (imported.startsWith('/'))
		imported = imported.substring(1);
	return {
		imported,
		pathIndex: match.index + match[1].length,
		pathLength: match[2].length,
	};
};

/**
 * @param {String} path 
 * @param {String} code 
 */
 export const allImportStatements = (path, code) => {
	const ret = [];
	let statement, lastIndex = 0;
	while (statement = nextImportStatement(path, code, lastIndex)) {
		ret.push(statement);
		lastIndex = statement.pathIndex;
	}
	return ret;
};

const topologicalSortHelper = (node, visited, cycle, graph, result) => {
	cycle[node] = true;
	const neighbors = graph[node];
	for (let i = 0; i < neighbors.length; i++) {
		var n = neighbors[i];
		if (cycle[n]) {
			const modList = Object.entries(cycle).filter(e => e[1]).map(e => e[0]).join(', ');
			throw new Error('Cyclic dependencies detected. Modules involved: '+modList);
		}
		if (!visited[n]) topologicalSortHelper(n, visited, cycle, graph, result);
	}
	cycle[node] = false;
	visited[node] = true;
	result.push(node);
};

/**
 * Topological sort adapted from Minko Gechev's javascript-algorithms.
 * @param {Array} graph Adjacency list, which represents the graph.
 * @returns {Array} Ordered vertices.
 * @example
 * var graph = {
 *     v1: ['v2', 'v5'],
 *     v2: [],
 *     v3: ['v1', 'v2', 'v4', 'v5'],
 *     v4: [],
 *     v5: []
 * };
 * var vertices = topologicalSort(graph); // ['v3', 'v4', 'v1', 'v5', 'v2']
 */
export const topologicalSort = graph => {
	const result = [];
	const visited = [];
	const cycle = {};
	for (let node in graph) {
		if (!visited[node] && !cycle[node])
			topologicalSortHelper(node, visited, cycle, graph, result);
	}
	return result;
};

