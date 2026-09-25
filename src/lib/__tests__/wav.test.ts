import { describe, it, expect } from 'vitest'
import { downmixToMono, resampleLinear, encodeWav16Mono } from '../wav'

describe('wav — downmixToMono', () => {
  it('averages stereo channels', () => {
    const out = downmixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 1, -1])])
    expect(Array.from(out)).toEqual([0.5, 0.5, -1])
  })

  it('passes mono through unchanged', () => {
    const mono = new Float32Array([0.1, 0.2])
    expect(downmixToMono([mono])).toBe(mono)
  })
})

describe('wav — resampleLinear', () => {
  it('halves the sample count when halving the rate', () => {
    const input = new Float32Array(100).fill(0.5)
    expect(resampleLinear(input, 32000, 16000).length).toBe(50)
  })

  it('is a no-op at equal rates', () => {
    const input = new Float32Array([1, 2, 3])
    expect(resampleLinear(input, 16000, 16000)).toBe(input)
  })
})

describe('wav — encodeWav16Mono (whisper-cli input format)', () => {
  it('writes a valid 44-byte RIFF/WAVE header for 16-bit mono PCM', () => {
    const wav = encodeWav16Mono(new Float32Array(100), 16000)
    const view = new DataView(wav)
    const str = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)))

    expect(wav.byteLength).toBe(44 + 200)
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(str(12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000) // byte rate
    expect(view.getUint16(34, true)).toBe(16) // bits
    expect(str(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(200)
  })

  it('clamps out-of-range samples instead of wrapping', () => {
    const wav = encodeWav16Mono(new Float32Array([2, -2, 0]), 16000)
    const view = new DataView(wav)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32768)
    expect(view.getInt16(48, true)).toBe(0)
  })
})
