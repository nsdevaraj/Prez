import { aaabstract, ffflux, pppsychedelic, rrreflection, sssurf, uuundulate, uuunion, } from './abstract.js';
import { bbburst, cccircular, mmmotif, qqquad, rrrainbow, rrrepeat, rrreplicate, ssscales, ttten, tttwinkle, } from './patterns.js';
import { cccoil, gggyrate, oooscillate, ssscribble, ssspiral, sssquiggly, wwwhirl, } from './curves.js';
import { ffflurry, llleaves, ssspot } from './organic.js';
import { bbblurry, hhholographic, wwwatercolor } from './textures.js';
import { ccchaos, gggrain, ggglitch, nnnoise } from './noise.js';
export const generators = {
    aaabstract,
    bbblurry,
    bbburst,
    ccchaos,
    cccircular,
    cccoil,
    ffflurry,
    ffflux,
    gggrain,
    ggglitch,
    gggyrate,
    hhholographic,
    llleaves,
    mmmotif,
    nnnoise,
    oooscillate,
    pppsychedelic,
    qqquad,
    rrrainbow,
    rrreflection,
    rrrepeat,
    rrreplicate,
    ssscales,
    ssscribble,
    ssspiral,
    ssspot,
    sssquiggly,
    sssurf,
    ttten,
    tttwinkle,
    uuundulate,
    uuunion,
    wwwatercolor,
    wwwhirl,
};
export function getGenerator(id) {
    return generators[id];
}
