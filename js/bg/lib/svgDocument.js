import { createRandom } from './random.js';
function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export function createRenderContext(params, options) {
    return {
        width: options.width,
        height: options.height,
        random: createRandom(options.seed),
        n: (key) => toNumber(params[key]),
        s: (key) => String(params[key] ?? ''),
        b: (key) => params[key] === true || params[key] === 'true',
    };
}
export function renderDocument(generator, params, options) {
    const { width, height, background, transparent } = options;
    const context = createRenderContext(params, options);
    const body = generator.render(context);
    const backdrop = transparent
        ? ''
        : `\n  <rect width="${width}" height="${height}" fill="${background}" />`;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">${backdrop}`,
        indent(body),
        '</svg>',
    ]
        .filter(Boolean)
        .join('\n');
}
function indent(markup) {
    return markup
        .split('\n')
        .map((line) => (line.trim() ? `  ${line}` : ''))
        .filter(Boolean)
        .join('\n');
}
export function svgToDataUrl(markup) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}
export async function svgToPngBlob(markup, width, height, scale = 2) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Unable to rasterize SVG'));
        image.src = svgToDataUrl(markup);
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Canvas 2D context unavailable');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            }
            else {
                reject(new Error('PNG export failed'));
            }
        }, 'image/png');
    });
}
