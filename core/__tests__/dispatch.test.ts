import { describe, it, expect } from 'vitest'
import { handleMessage, createDispatchState, methodGroup, type DispatchOptions, type MethodTable } from '../dispatch'
import { ErrorCodes, PROTOCOL_VERSION } from '../protocol'

function makeOptions(overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  const methods: MethodTable = new Map([
    ['fs.exists', { capability: 'fs', handler: () => ({ exists: true }) }],
    ['chats.load', { capability: 'chats', handler: () => [] }],
    ['shell.execute', { capability: 'shell', handler: () => ({ success: true }) }],
    [
      'fs.boom',
      {
        capability: 'fs',
        handler: () => {
          throw new Error('disk on fire')
        },
      },
    ],
  ])
  return { methods, dataDir: 'C:\\Users\\t\\.kora', ...overrides }
}

function helloMessage(capabilities?: string[]) {
  return {
    jsonrpc: '2.0',
    id: 0,
    method: 'core.hello',
    params: { client: 'kora-test', clientVersion: '0', protocol: PROTOCOL_VERSION, capabilities },
  }
}

describe('handshake (docs/CORE_RPC.md §3)', () => {
  it('answers core.hello with version, protocol, capabilities and dataDir', async () => {
    const state = createDispatchState('C:\\Users\\t\\.kora')
    const res = await handleMessage(helloMessage(), state, makeOptions())
    expect(res).toMatchObject({
      jsonrpc: '2.0',
      id: 0,
      result: {
        coreVersion: expect.any(String),
        protocol: 'kora-rpc/1',
        dataDir: 'C:\\Users\\t\\.kora',
      },
    })
  })

  it('rejects any request before a successful hello with -32002', async () => {
    const state = createDispatchState('x')
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'fs.exists', params: ['/tmp'] },
      state,
      makeOptions(),
    )
    expect(res).toMatchObject({
      id: 5,
      error: { code: ErrorCodes.notInitialized, message: expect.stringContaining('core.hello') },
    })
  })

  it('rejects a protocol mismatch with the expected version in data', async () => {
    const state = createDispatchState('x')
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'core.hello', params: { client: 'c', protocol: 'kora-rpc/0' } },
      state,
      makeOptions(),
    )
    expect(res).toMatchObject({
      id: 1,
      error: { code: ErrorCodes.invalidRequest, data: { expected: 'kora-rpc/1' } },
    })
  })

  it('accepts a single positional object params form', async () => {
    const state = createDispatchState('x')
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 2, method: 'core.hello', params: [{ client: 'c', protocol: PROTOCOL_VERSION }] },
      state,
      makeOptions(),
    )
    expect(res).toMatchObject({ id: 2, result: { protocol: 'kora-rpc/1' } })
  })
})

describe('capability enforcement (docs/CORE_RPC.md §6)', () => {
  it('serves a method whose capability was granted', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 3, method: 'fs.exists', params: ['/tmp'] },
      state,
      makeOptions(),
    )
    expect(res).toEqual({ jsonrpc: '2.0', id: 3, result: { exists: true } })
  })

  it('denies (-32003) a method whose capability was not granted', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 4, method: 'shell.execute', params: ['dir'] },
      state,
      makeOptions(),
    )
    expect(res).toMatchObject({
      id: 4,
      error: { code: ErrorCodes.denied, data: { capability: 'shell' } },
    })
  })

  it('a shell with no declared capabilities cannot call anything (not even fs)', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage([]), state, makeOptions())
    const res = await handleMessage(
      { jsonrpc: '2.0', id: 5, method: 'fs.exists', params: ['/tmp'] },
      state,
      makeOptions(),
    )
    expect(res).toMatchObject({ error: { code: ErrorCodes.denied } })
  })
})

describe('routing and error capture', () => {
  it('unknown method → -32601', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const res = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'fs.nope' }, state, makeOptions())
    expect(res).toMatchObject({ error: { code: ErrorCodes.methodNotFound } })
  })

  it('a throwing handler becomes -32001 kora_error, never a crash', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const res = await handleMessage({ jsonrpc: '2.0', id: 7, method: 'fs.boom' }, state, makeOptions())
    expect(res).toMatchObject({
      id: 7,
      error: { code: ErrorCodes.koraError, message: 'disk on fire', data: { detail: 'disk on fire' } },
    })
  })

  it('missing jsonrpc field → -32600; missing method → -32600 only when id present', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const bad = await handleMessage({ jsonrpc: '1.0', id: 8, method: 'fs.exists' }, state, makeOptions())
    expect(bad).toMatchObject({ error: { code: ErrorCodes.invalidRequest } })

    const noMethod = await handleMessage({ jsonrpc: '2.0', id: 9 }, state, makeOptions())
    expect(noMethod).toMatchObject({ error: { code: ErrorCodes.invalidRequest } })

    const notification = await handleMessage({ jsonrpc: '2.0', method: 'fs.exists' }, state, makeOptions())
    expect(notification).toBeNull()
  })

  it('handler errors do not leak stack traces', async () => {
    const state = createDispatchState('x')
    await handleMessage(helloMessage(['fs']), state, makeOptions())
    const res = await handleMessage({ jsonrpc: '2.0', id: 10, method: 'fs.boom' }, state, makeOptions())
    expect(JSON.stringify(res)).not.toContain('at ')
  })
})

describe('methodGroup', () => {
  it('splits domain from method name', () => {
    expect(methodGroup('fs.readFile')).toBe('fs')
    expect(methodGroup('agent.startCycle')).toBe('agent')
    expect(methodGroup('core.hello')).toBe('core')
  })
})
