export class Rng {
    seed: number;
    count: number = 0;
    constructor(seed: number) {
        this.seed = seed;
    }
    next(): number {
        this.count++;
        let total = this.seed + this.count;
        let s = total >>> 0;
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    }
}

