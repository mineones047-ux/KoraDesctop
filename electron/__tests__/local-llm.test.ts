import { describe, expect, it } from 'vitest'
import path from 'path'
import {
  expandShards,
  fitsProfile,
  hfDownloadUrl,
  hfSearchUrl,
  hfTreeUrl,
  parseHfSearch,
  parseHfTree,
  parseParamsB,
  pickBestFile,
  pickEngineAsset,
  parseVramSmi,
  quantOfFile,
  recommendFor,
  recommendsProfile,
  safeModelTarget,
  shardGroup,
  type HfGgufFile,
} from '../services/local-llm'

const profile = (ramGb: number) => ({ ramGb, cpuCores: 8, vramGb: null })

const file = (path_: string, size: number, quant: string, paramsB: number | null): HfGgufFile => ({
  path: path_,
  sizeBytes: size,
  quant,
  paramsB,
})

describe('parseParamsB', () => {
  it('reads the parameter count from real repo/file names', () => {
    expect(parseParamsB('Llama-3.2-3B-Instruct-GGUF')).toBe(3)
    expect(parseParamsB('Qwen/Qwen2.5-7B-Instruct-GGUF')).toBe(7)
    expect(parseParamsB('Qwen2.5-1.5B-Instruct')).toBe(1.5)
    expect(parseParamsB('gemma-2-27b-it')).toBe(27)
    expect(parseParamsB('DeepSeek-R1-Distill-Qwen-14B')).toBe(14)
  })

  it('returns null when the name advertises no B-scale', () => {
    expect(parseParamsB('SmolLM2-135M-Instruct')).toBeNull()
    expect(parseParamsB('some-repo-without-scale')).toBeNull()
    expect(parseParamsB('f16')).toBeNull()
  })
})

describe('quantOfFile', () => {
  it('extracts k-quants, legacy quants and integer quants', () => {
    expect(quantOfFile('Llama-3.2-3B-Instruct-Q4_K_M.gguf')).toBe('Q4_K_M')
    expect(quantOfFile('model-Q3_K_L.gguf')).toBe('Q3_K_L')
    expect(quantOfFile('model.Q8_0.gguf')).toBe('Q8_0')
    expect(quantOfFile('model-Q4_0.gguf')).toBe('Q4_0')
    expect(quantOfFile('split-00001-of-00002-IQ4_XS.gguf')).toBe('IQ4_XS')
    expect(quantOfFile('weights-f16.gguf')).toBe('F16')
  })

  it('returns null for files without a quant marker', () => {
    expect(quantOfFile('README.md')).toBeNull()
    expect(quantOfFile('model.gguf')).toBeNull()
  })
})

describe('shardGroup', () => {
  it('splits the name of a sharded model', () => {
    expect(shardGroup('Model-Q4_K_M-00002-of-00004.gguf')).toEqual({
      prefix: 'Model-Q4_K_M',
      index: 2,
      total: 4,
    })
  })

  it('is null for a single-file model', () => {
    expect(shardGroup('Model-Q4_K_M.gguf')).toBeNull()
  })
})

describe('recommendFor', () => {
  it('scales the model class with RAM', () => {
    expect(recommendFor(profile(6)).maxParamsB).toBe(3)
    expect(recommendFor(profile(8)).maxParamsB).toBe(4)
    expect(recommendFor(profile(16)).maxParamsB).toBe(8)
    expect(recommendFor(profile(32)).maxParamsB).toBe(14)
    expect(recommendFor(profile(48)).maxParamsB).toBe(32)
    expect(recommendFor(profile(96)).maxParamsB).toBe(70)
  })

  it('keeps the quant affordable for the tier', () => {
    expect(recommendFor(profile(8)).quant).toBe('Q4_K_M')
    expect(recommendFor(profile(32)).quant).toBe('Q5_K_M')
  })
})

describe('profile gates', () => {
  it('fits anything at or under the ceiling', () => {
    expect(fitsProfile(8, profile(16))).toBe(true)
    expect(fitsProfile(9, profile(16))).toBe(false)
    expect(fitsProfile(null, profile(16))).toBe(false)
  })

  it('recommends only the top half of the ceiling', () => {
    expect(recommendsProfile(8, profile(16))).toBe(true)
    expect(recommendsProfile(4, profile(16))).toBe(true)
    expect(recommendsProfile(3, profile(16))).toBe(false)
    expect(recommendsProfile(null, profile(16))).toBe(false)
  })
})

describe('pickBestFile', () => {
  const sixteenGb = profile(16) // ceiling 8B, preferred Q4_K_M

  it('prefers the recommended quant of the largest fitting model', () => {
    const files = [
      file('a-Q4_K_M.gguf', 9_000_000_000, 'Q4_K_M', 14),
      file('b-Q5_K_M.gguf', 6_000_000_000, 'Q5_K_M', 8),
      file('c-Q4_K_M.gguf', 5_000_000_000, 'Q4_K_M', 7),
      file('d-Q4_K_M.gguf', 2_500_000_000, 'Q4_K_M', 3),
    ]
    expect(pickBestFile(files, sixteenGb)?.path).toBe('c-Q4_K_M.gguf')
  })

  it('never picks a model above the ceiling when fitting ones exist', () => {
    const files = [
      file('huge-Q4_K_M.gguf', 20_000_000_000, 'Q4_K_M', 32),
      file('ok-Q4_K_M.gguf', 5_000_000_000, 'Q4_K_M', 7),
    ]
    expect(pickBestFile(files, sixteenGb)?.path).toBe('ok-Q4_K_M.gguf')
  })

  it('falls back to unknown-scale files only when nothing fits', () => {
    const files = [
      file('huge-Q4_K_M.gguf', 20_000_000_000, 'Q4_K_M', 32),
      file('unknown-Q4_K_M.gguf', 4_000_000_000, 'Q4_K_M', null),
    ]
    expect(pickBestFile(files, sixteenGb)?.path).toBe('unknown-Q4_K_M.gguf')
  })

  it('returns null for an empty repo', () => {
    expect(pickBestFile([], sixteenGb)).toBeNull()
  })
})

describe('Hugging Face payloads', () => {
  it('parses the search response and keeps ids unique', () => {
    const parsed = parseHfSearch([
      { id: 'bartowski/Llama-3.2-3B-Instruct-GGUF', downloads: 154135, likes: 242 },
      { id: 'bartowski/Llama-3.2-3B-Instruct-GGUF', downloads: 154135, likes: 242 },
      { modelId: 'Qwen/Qwen2.5-7B-Instruct-GGUF', downloads: 10 },
      { nope: true },
    ])
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toEqual({ id: 'bartowski/Llama-3.2-3B-Instruct-GGUF', downloads: 154135, likes: 242, paramsB: 3 })
    expect(parsed[1].paramsB).toBe(7)
  })

  it('keeps only gguf files, reads lfs sizes and marks shards', () => {
    const parsed = parseHfTree([
      { path: 'Model-Q4_K_M.gguf', type: 'file', size: 123 },
      { path: 'notes.txt', type: 'file', size: 5 },
      { path: 'nested', type: 'directory' },
      { path: 'Big-00001-of-00002.gguf', type: 'file', lfs: { size: 777 } },
    ])
    expect(parsed.map((f) => f.path)).toEqual(['Big-00001-of-00002.gguf', 'Model-Q4_K_M.gguf'])
    expect(parsed[0].sizeBytes).toBe(777)
    expect(parsed[0].shardPrefix).toBe('Big')
    expect(parsed[1].quant).toBe('Q4_K_M')
  })

  it('builds encoded URLs', () => {
    expect(hfSearchUrl('qwen 7b')).toContain('search=qwen%207b')
    expect(hfSearchUrl('qwen 7b')).toContain('filter=gguf')
    expect(hfTreeUrl('org/repo')).toBe('https://huggingface.co/api/models/org/repo/tree/main?recursive=true')
    expect(hfDownloadUrl('org/repo', 'sub dir/model.gguf')).toBe(
      'https://huggingface.co/org/repo/resolve/main/sub%20dir/model.gguf',
    )
  })
})

describe('expandShards', () => {
  const files = [
    file('Big-00001-of-00002.gguf', 1, 'Q4_K_M', 7),
    file('Big-00002-of-00002.gguf', 2, 'Q4_K_M', 7),
    file('Other.gguf', 3, 'Q4_K_M', 3),
  ]

  it('returns the whole group when one part is chosen', () => {
    expect(expandShards(files, files[0]).map((f) => f.path)).toEqual([
      'Big-00001-of-00002.gguf',
      'Big-00002-of-00002.gguf',
    ])
  })

  it('returns the file itself when it is not sharded', () => {
    expect(expandShards(files, files[2])).toEqual([files[2]])
  })
})

describe('pickEngineAsset', () => {
  const assets = [
    { name: 'llama-b11476-bin-win-cuda-12.4-x64.zip', url: 'u1', sizeBytes: 265_000_000 },
    { name: 'llama-b11476-bin-win-cpu-x64.zip', url: 'u2', sizeBytes: 19_000_000 },
    { name: 'llama-b11476-bin-win-cpu-arm64.zip', url: 'u3', sizeBytes: 12_000_000 },
    { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip', url: 'u4', sizeBytes: 391_000_000 },
  ]

  it('picks the plain CPU x64 build on Windows, never a CUDA one', () => {
    expect(pickEngineAsset(assets, 'win32', 'x64')?.url).toBe('u2')
  })

  it('returns null when the platform has no matching build', () => {
    expect(pickEngineAsset([assets[0]], 'win32', 'x64')).toBeNull()
    expect(pickEngineAsset([], 'linux', 'x64')).toBeNull()
  })
})

describe('parseVramSmi', () => {
  it('sums every GPU in MiB and converts to GB', () => {
    expect(parseVramSmi('12288\r\n')).toBe(12)
    expect(parseVramSmi('8192\n8192\n')).toBe(16)
  })

  it('is null when the GPU reports nothing usable', () => {
    expect(parseVramSmi('')).toBeNull()
    expect(parseVramSmi('N/A\n')).toBeNull()
  })
})

describe('safeModelTarget', () => {
  // Absolute, so startsWith assertions compare like with like.
  const modelsDir = path.resolve('tmp-kora-models-test')

  it('keeps the target inside the models directory', () => {
    const target = safeModelTarget(modelsDir, 'org/repo', 'sub/model-Q4_K_M.gguf', path)
    expect(target?.full.startsWith(path.resolve(modelsDir))).toBe(true)
    expect(target?.fileName).toBe('model-Q4_K_M.gguf')
  })

  it('sanitises traversal-shaped repo ids instead of escaping', () => {
    const target = safeModelTarget(modelsDir, '../../../etc', '../evil.gguf', path)
    expect(target?.full.startsWith(path.resolve(modelsDir))).toBe(true)
    expect(target?.fileName).toBe('evil.gguf')
  })

  it('rejects non-gguf files', () => {
    expect(safeModelTarget(modelsDir, 'org/repo', 'malware.exe', path)).toBeNull()
  })
})
