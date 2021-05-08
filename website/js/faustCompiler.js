import Module from './lib/faust/libfaust-wasm.js';

let libFaust, em, faustPromise;
const getFaustPromise = () => new Promise(resolve => {
	console.log('Initializing Faust compiler.');
    Module().then(mod => {
        let ret = {};
        ret.createWasmCDSPFactoryFromString = mod.cwrap("createWasmCDSPFactoryFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        ret.deleteAllWasmCDSPFactories = mod.cwrap("deleteAllWasmCDSPFactories", null, []);
        ret.expandCDSPFromString = mod.cwrap("expandCDSPFromString", "number", ["number", "number", "number", "number", "number", "number"]);
        ret.getCLibFaustVersion = mod.cwrap("getCLibFaustVersion", "number", []);
        ret.getWasmCModule = mod.cwrap("getWasmCModule", "number", ["number"]);
        ret.getWasmCModuleSize = mod.cwrap("getWasmCModuleSize", "number", ["number"]);
        ret.getWasmCHelpers = mod.cwrap("getWasmCHelpers", "number", ["number"]);
        ret.freeWasmCModule = mod.cwrap("freeWasmCModule", null, ["number"]);
        ret.freeCMemory = mod.cwrap("freeCMemory", null, ["number"]);
        ret.cleanupAfterException = mod.cwrap("cleanupAfterException", null, []);
        ret.getErrorAfterException = mod.cwrap("getErrorAfterException", "number", []);
        ret.getLibFaustVersion = () => mod.UTF8ToString(this.getCLibFaustVersion());
        ret.generateCAuxFilesFromString = mod.cwrap("generateCAuxFilesFromString", "number", ["number", "number", "number", "number", "number"]);
        em = mod;
        libFaust = ret;
        resolve(ret);
    });
});

/**
 * Generate Uint8Array and helpersCode from a dsp source code.
 * This code is adapted from faust2webaudio and appears to follow
 * the following conventions:
 * 
 * - $mydata is the memory offset (pointer) of data in wasm/em memory
 * - mydata$ is a js typed array which is a view of the wasm/em data
 *
 * @param {string} factoryName - Class name of the source code
 * @param {string} code - dsp source code
 * @param {string[]} argv - Array of parameters to be given to the Faust compiler
 * @param {boolean} internalMemory - Use internal Memory flag, false for poly, true for mono(phonic)
 * @returns {Object} - ui8Code is wasm bytecode, helpersCode is C (?) code to extract metadata from
 */
const compileCode = (factoryName, code, argv=[], internalMemory) => {
    const codeSize = em.lengthBytesUTF8(code) + 1;
    const $code = em._malloc(codeSize);
    const name = "FaustDSP";
    const nameSize = em.lengthBytesUTF8(name) + 1;
    const $name = em._malloc(nameSize);
    const $errorMsg = em._malloc(4096);

    em.stringToUTF8(name, $name, nameSize);
    em.stringToUTF8(code, $code, codeSize);

    argv.push("-cn", factoryName);
    argv.push("-I", "/libraries");

    // Prepare 'argv_aux' array for C side
    const ptrSize = 4;
    const $argv = em._malloc(argv.length * ptrSize); // Get buffer from emscripten.
    let argvBuffer$ = new Int32Array(em.HEAP32.buffer, $argv, argv.length); // Get a integer view on the newly allocated buffer.
    for (let i = 0; i < argv.length; i++) {
        const size$arg = em.lengthBytesUTF8(argv[i]) + 1;
        const $arg = em._malloc(size$arg);
        em.stringToUTF8(argv[i], $arg, size$arg);
        argvBuffer$[i] = $arg;
    }
    try {
        // const time1 = performance.now();
        const $moduleCode = libFaust.createWasmCDSPFactoryFromString($name, $code, argv.length, $argv, $errorMsg, internalMemory);
        // const time2 = performance.now();
        // faustLog("Faust compilation duration : " + (time2 - time1));
        const errorMsg = em.UTF8ToString($errorMsg);
        if (errorMsg) throw new Error(errorMsg);

        if ($moduleCode === 0) return null;
        const $compiledCode = libFaust.getWasmCModule($moduleCode);
        const compiledCodeSize = libFaust.getWasmCModuleSize($moduleCode);
        // Copy native 'binary' string in JavaScript Uint8Array
        const ui8Code = new Uint8Array(compiledCodeSize);
        for (let i = 0; i < compiledCodeSize; i++) {
            // faster than 'getValue' which gets the type of access for each read...
            ui8Code[i] = em.HEAP8[$compiledCode + i];
        }
        const $helpersCode = libFaust.getWasmCHelpers($moduleCode);
        const helpersCode = em.UTF8ToString($helpersCode);
        // Free strings
        em._free($code);
        em._free($name);
        em._free($errorMsg);
        // Free C allocated wasm module
        libFaust.freeWasmCModule($moduleCode);
        // Get an updated integer view on the newly allocated buffer after possible emscripten memory grow
        argvBuffer$ = new Int32Array(em.HEAP32.buffer, $argv, argv.length);
        // Free 'argv' C side array
        for (let i = 0; i < argv.length; i++) {
            em._free(argvBuffer$[i]);
        }
        em._free($argv);
        return { ui8Code, helpersCode };
    } catch (e) {
        // libfaust is compiled without C++ exception activated, so a JS exception is thrown and caught here
        const errorMsg = em.UTF8ToString(libFaust.getErrorAfterException());
        libFaust.cleanupAfterException();
        // Report the Emscripten error
        throw errorMsg ? new Error(errorMsg) : e;
    }
}

const factoryId = (() => {
	let count = 100;
	return () => 'fact'+(++count);
})();

export const compileFaust = async (code, internalMemory) => {	
	if (!faustPromise) faustPromise = getFaustPromise();
	await faustPromise;
	const {ui8Code, helpersCode} = compileCode(factoryId(), code, [], internalMemory);
	const json = helpersCode.match(/getJSON\w+?\(\)[\s\n]*{[\s\n]*return[\s\n]*'(\{.+?)';}/)[1].replace(/\\'/g, "'");
	const dspMeta = JSON.parse(json);
	return {ui8Code, dspMeta};
};