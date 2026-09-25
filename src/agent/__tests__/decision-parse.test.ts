import { describe, it, expect } from 'vitest'
// Import the REAL production parser the ReAct loop uses (orchestrator.ts).
import { parseAgentResponse } from '../orchestrator'

describe('parseAgentResponse — agent decision protocol', () => {
  it('parses a clean call_tool decision', () => {
    const d = parseAgentResponse(
      JSON.stringify({ thought: 'need listing', action: 'call_tool', tool: 'dir', parameters: { path: '~' } }),
    )
    expect(d).toEqual({ thought: 'need listing', action: 'call_tool', tool: 'dir', parameters: { path: '~' } })
  })

  it('parses a finish decision', () => {
    const d = parseAgentResponse('{"thought":"done","action":"finish","answer":"42"}')
    expect(d?.action).toBe('finish')
    expect(d?.answer).toBe('42')
  })

  it('tolerates markdown fences (models decorate despite json mode)', () => {
    const d = parseAgentResponse('```json\n{"thought":"t","action":"finish","answer":"ok"}\n```')
    expect(d?.action).toBe('finish')
  })

  it('tolerates prose around the object', () => {
    const d = parseAgentResponse('Sure! Here is my decision:\n{"thought":"t","action":"call_tool","tool":"dir"}')
    expect(d?.action).toBe('call_tool')
    expect(d?.tool).toBe('dir')
  })

  it('rejects non-JSON text', () => {
    expect(parseAgentResponse('I think I should list the directory first.')).toBeNull()
  })

  it('rejects JSON without a valid action', () => {
    expect(parseAgentResponse('{"thought":"hmm","action":"dance"}')).toBeNull()
  })

  it('rejects truncated JSON', () => {
    expect(parseAgentResponse('{"thought":"t","action":"call_tool","tool":"dir"')).toBeNull()
  })
})
