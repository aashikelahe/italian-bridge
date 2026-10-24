/**
 * IMA ADPCM: 16-bit audio squeezed to 4 bits a sample (64 kbit/s at 16 kHz). Tiny, fast, and
 * every frame decodes on its own (the frame header carries the decoder state).
 */
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

export interface AdpcmState { pred: number; index: number }

/** Encode float samples (-1..1). Returns [pred lo, pred hi, index, ...packed nibbles]. Updates `st`. */
export function adpcmEncode(samples: Float32Array, st: AdpcmState): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(3 + Math.ceil(n / 2));
  out[0] = st.pred & 0xff; out[1] = (st.pred >> 8) & 0xff; out[2] = st.index;
  let pred = st.pred, index = st.index;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    let diff = s - pred;
    let nib = 0;
    if (diff < 0) { nib = 8; diff = -diff; }
    let step = STEP[index];
    let vp = step >> 3;
    if (diff >= step) { nib |= 4; diff -= step; vp += step; }
    step >>= 1;
    if (diff >= step) { nib |= 2; diff -= step; vp += step; }
    step >>= 1;
    if (diff >= step) { nib |= 1; vp += step; }
    pred += nib & 8 ? -vp : vp;
    if (pred > 32767) pred = 32767; else if (pred < -32768) pred = -32768;
    index += INDEX[nib];
    if (index < 0) index = 0; else if (index > 88) index = 88;
    const b = 3 + (i >> 1);
    out[b] |= i & 1 ? nib << 4 : nib;
  }
  st.pred = pred; st.index = index;
  return out;
}

/** Decode one frame made by adpcmEncode (n = number of samples). */
export function adpcmDecode(data: Uint8Array, n: number): Float32Array {
  let pred = (data[0] | (data[1] << 8)) << 16 >> 16;
  let index = Math.min(88, data[2]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const byte = data[3 + (i >> 1)] ?? 0;
    const nib = i & 1 ? byte >> 4 : byte & 15;
    const step = STEP[index];
    let vp = step >> 3;
    if (nib & 4) vp += step;
    if (nib & 2) vp += step >> 1;
    if (nib & 1) vp += step >> 2;
    pred += nib & 8 ? -vp : vp;
    if (pred > 32767) pred = 32767; else if (pred < -32768) pred = -32768;
    index += INDEX[nib];
    if (index < 0) index = 0; else if (index > 88) index = 88;
    out[i] = pred / 32768;
  }
  return out;
}
