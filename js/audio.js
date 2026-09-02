// ================== AUDIO ==================
// Owns the AudioContext (created lazily on first play to avoid
// browser autoplay warnings) and all active source nodes.

let _audioCtx = null;

// All currently playing AudioBufferSourceNodes.
// Exported as a shared reference — display.js pushes to it,
// stopAllSounds() clears it, both see the same array.
export const globalSources = [];

export function getAudioContext() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

export async function fetchAndDecode(url) {
  const ctx = getAudioContext();
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

export function stopAllSounds() {
  globalSources.forEach((src) => {
    try { src.stop();       } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  });
  globalSources.length = 0;
}

// Pick a weighted random clip from [{clip, chance, volume}]
export function pickWeighted(subSounds) {
  const table = [];
  subSounds.forEach((s) => {
    const pct = parseFloat(s.chance);
    if (!isNaN(pct) && pct > 0) table.push({ url: s.clip, weight: pct, vol: s.volume });
  });
  if (!table.length) return { url: subSounds[0].clip, perSoundVolume: subSounds[0].volume };
  const total = table.reduce((a, b) => a + b.weight, 0);
  let roll = Math.random() * total;
  for (const row of table) {
    if ((roll -= row.weight) <= 0) return { url: row.url, perSoundVolume: row.vol };
  }
  return { url: table[table.length - 1].url, perSoundVolume: table[table.length - 1].vol };
}

export function createReversedBuffer(srcBuffer) {
  const ctx = getAudioContext();
  const numChannels = srcBuffer.numberOfChannels;
  const rev = ctx.createBuffer(numChannels, srcBuffer.length, srcBuffer.sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const ch    = srcBuffer.getChannelData(c);
    const revCh = rev.getChannelData(c);
    for (let i = 0, L = ch.length; i < L; i++) revCh[i] = ch[L - 1 - i];
  }
  return rev;
}