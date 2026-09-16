import { describe, it, expect } from 'vitest'
import { needsAgent, hasToolIntent, isCommandMessage } from '../intent'

describe('isCommandMessage', () => {
  it('detects leading ! commands', () => {
    expect(isCommandMessage('!dir ~')).toBe(true)
    expect(isCommandMessage('  !shell dir')).toBe(true)
  })
  it('rejects plain text', () => {
    expect(isCommandMessage('hello')).toBe(false)
  })
})

describe('hasToolIntent', () => {
  it('detects a real filesystem path', () => {
    expect(hasToolIntent('what is in C:\\Users\\me\\Desktop')).toBe(true)
    expect(hasToolIntent('show ~/notes')).toBe(true)
  })
  it('detects file/system action keywords', () => {
    expect(hasToolIntent('list files in my home directory')).toBe(true)
    expect(hasToolIntent('create a folder called test')).toBe(true)
  })
  it('detects web intent', () => {
    expect(hasToolIntent('search for latest AI news')).toBe(true)
  })
  it('does not flag casual chat', () => {
    expect(hasToolIntent('tell me a joke')).toBe(false)
  })
})

describe('needsAgent', () => {
  it('routes commands away from the agent', () => {
    expect(needsAgent('!dir ~')).toBe(false)
  })
  it('keeps conversational overrides out of the agent', () => {
    expect(needsAgent('hi there')).toBe(false)
    expect(needsAgent('how are you')).toBe(false)
  })
  it('routes tool-y requests to the agent', () => {
    expect(needsAgent('list the files in my desktop folder')).toBe(true)
    expect(needsAgent('what is in C:\\Users\\me\\Desktop')).toBe(true)
  })
})
