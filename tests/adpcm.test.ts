import { adpcmDecode, adpcmEncode } from '../src/online/adpcm';

describe('voice codec', () => {
  it('round-trips speech-like audio closely and frames decode independently', () => {
    const st = { pred: 0, index: 0 };
    const frames: Float32Array[] = [];
    for (let f = 0; f < 4; f++) {
      const x = new Float32Array(960);
      for (let i = 0; i < 960; i++) { const t = (f * 960 + i) / 16000; x[i] = 0.4 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 900 * t); }
      frames.push(x);
    }
    const enc = frames.map((x) => adpcmEncode(x, st));
    expect(enc[0].length).toBe(3 + 480);
    // decode frame 2 alone
    const y = adpcmDecode(enc[2], 960);
    let err = 0, pow = 0;
    for (let i = 0; i < 960; i++) { err += (y[i] - frames[2][i]) ** 2; pow += frames[2][i] ** 2; }
    expect(10 * Math.log10(pow / err)).toBeGreaterThan(15);
  });
});
