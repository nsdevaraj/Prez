export function createRandom(seed) {
    let state = (Math.floor(seed) || 1) >>> 0;
    return function random() {
        state += 0x6d2b79f5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function range(random, min, max) {
    return min + random() * (max - min);
}
export function pick(random, items) {
    return items[Math.floor(random() * items.length) % items.length];
}
export function times(count, map) {
    return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => map(index));
}
