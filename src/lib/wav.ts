/**
 * PCM/WAV helpers for the local whisper.cpp STT path (ROADMAP Phase 0).
 *
 * MediaRecorder gives us webm/opus; whisper-cli wants 16 kHz mono PCM WAV.
 * The browser decodes the blob via AudioContext.decodeAudioData; these pure
 * functions do the downmix, linear resample and WAV container writing so the
 * result can be unit-tested (no DOM needed).
 */

/** Average N channels into one (whisper wants mono). */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return channels[0]
  const length = Math.min(...channels.map((c) => c.length))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const c of channels) sum += c[i]
    out[i] = sum / channels.length
  }
  return out
}

/** Cheap linear resampler — good enough for 44.1/48 kHz → 16 kHz speech. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input
  const ratio = fromRate / toRate
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx] ?? 0
    const b = input[idx + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

/**
 * Encode float samples (−1..1) as a 16-bit mono PCM WAV file (44-byte header).
 * This is exactly the format `whisper-cli -f file.wav` expects.
 */
export function encodeWav16Mono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM format
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  return buffer
}
