import { MultiRenderer } from './multirender.js';
import { offlineInit, macroEvents, playUpToStamp } from '../core/macro.js';
import { path } from './deps.js';

export const renderMacro = async (projDir, macroPath, outPath) => {

    const content = await Deno.readTextFile(macroPath);
    const lines = content.split('\n');
    const r = new MultiRenderer();

    // i think the web version reuses params from oldPatch
    // todo make this more consistent between versions
    macroEvents.startPatch = (patchName, params, oldPatch) => {
        const paramObj = {};
        for (const p of params) paramObj[p.name] = p.valStr;
        const mainPath = path.join(projDir, patchName, 'main.js');
        return r.addPatch(mainPath, paramObj);
    };
    macroEvents.tweakPatch = (cmdPatch, param) => {
        if (!cmdPatch) throw new Error('no such patch.');
        r.tweakPatch(cmdPatch, { [param.name]: param.valStr });
    };
    macroEvents.stopPatch = (cmdPatch) => {
        if (!cmdPatch) throw new Error('no such patch.');
        r.removePatch(cmdPatch);
    };
    macroEvents.setHighlight = (file, lineNum) => {
        console.log(lines[lineNum-1]);
    };
    console.log('\nrendering track: ' + path.basename(macroPath));
	const perfStart = performance.now();
    const outHandle = await r.addOutput(outPath);
    let nowStamp = 0;
    offlineInit();
    while (true) {
        const nextStamp = playUpToStamp(content, nowStamp);
        if (nextStamp === Number.MAX_VALUE) {
            await r.removeOutput(outHandle);
            break;
        }
        await r.render((nextStamp - nowStamp)/1000);
        nowStamp = nextStamp;
    }
    const perfTime = performance.now() - perfStart;
    console.log('done. speed: '+(Math.round(100*nowStamp/perfTime)/100)+'x');
    await r.finalize();
}