import { round } from './geometry.js';
export function stopsFromColors(colors) {
    if (colors.length === 1) {
        return [
            { offset: 0, color: colors[0] },
            { offset: 1, color: colors[0] },
        ];
    }
    return colors.map((color, index) => ({ offset: index / (colors.length - 1), color }));
}
function renderStops(stops) {
    return stops
        .map((stop) => `<stop offset="${round(stop.offset, 4)}" stop-color="${stop.color}"${stop.opacity === undefined ? '' : ` stop-opacity="${round(stop.opacity, 3)}"`} />`)
        .join('');
}
export function linearGradient(id, stops, angleDeg = 0, 
/** When provided the gradient spans the whole canvas instead of each shape. */
userSpace) {
    const angle = (angleDeg * Math.PI) / 180;
    const x = Math.cos(angle) / 2;
    const y = Math.sin(angle) / 2;
    const units = userSpace ? ' gradientUnits="userSpaceOnUse"' : '';
    const scaleX = userSpace ? userSpace.width : 1;
    const scaleY = userSpace ? userSpace.height : 1;
    return `<linearGradient id="${id}"${units} x1="${round((0.5 - x) * scaleX, 4)}" y1="${round((0.5 - y) * scaleY, 4)}" x2="${round((0.5 + x) * scaleX, 4)}" y2="${round((0.5 + y) * scaleY, 4)}">${renderStops(stops)}</linearGradient>`;
}
export function radialGradient(id, stops, cx = 0.5, cy = 0.5, r = 0.75) {
    return `<radialGradient id="${id}" cx="${round(cx, 4)}" cy="${round(cy, 4)}" r="${round(r, 4)}">${renderStops(stops)}</radialGradient>`;
}
export function blurFilter(id, deviation) {
    return `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${round(deviation, 2)}" /></filter>`;
}
export function displaceFilter(id, options) {
    const { frequency, octaves, scale, seed } = options;
    return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%">
  <feTurbulence type="fractalNoise" baseFrequency="${round(frequency, 4)}" numOctaves="${Math.max(1, Math.round(octaves))}" seed="${Math.round(seed)}" result="turb" />
  <feDisplacementMap in="SourceGraphic" in2="turb" scale="${round(scale, 2)}" xChannelSelector="R" yChannelSelector="G" />
</filter>`;
}
export function grainFilter(id, options) {
    const { frequency, octaves, monochrome, seed } = options;
    const desaturate = monochrome
        ? '<feColorMatrix type="saturate" values="0" />'
        : '<feColorMatrix type="saturate" values="1.15" />';
    return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="${round(frequency, 4)}" numOctaves="${Math.max(1, Math.round(octaves))}" seed="${Math.round(seed)}" stitchTiles="stitch" />
  ${desaturate}
</filter>`;
}
export function defs(...blocks) {
    const content = blocks.filter(Boolean).join('\n');
    return content ? `<defs>\n${content}\n</defs>` : '';
}
