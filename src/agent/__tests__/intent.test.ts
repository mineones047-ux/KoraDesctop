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

/**
 * Chinese has no spaces between words and its characters are not `\w`, so `\b` never
 * matches — a pattern written the English way silently fails on every Chinese request.
 * These cases exist to keep that from regressing when the patterns are edited.
 */
describe('Chinese intent routing', () => {
  it('detects filesystem intent', () => {
    expect(hasToolIntent('我桌面上有什么')).toBe(true)
    expect(hasToolIntent('列出 C:\\Users\\me\\Desktop 里的文件')).toBe(true)
    expect(hasToolIntent('帮我新建一个文件夹')).toBe(true)
  })

  it('detects system and web intent', () => {
    expect(hasToolIntent('帮我看看电脑的 CPU 和内存')).toBe(true)
    expect(hasToolIntent('上网搜一下最近的 AI 新闻')).toBe(true)
  })

  it('routes Chinese small talk to chat, not to the agent', () => {
    expect(needsAgent('你好')).toBe(false)
    expect(needsAgent('你是谁')).toBe(false)
    expect(needsAgent('谢谢，辛苦了')).toBe(false)
  })

  it('routes Chinese task requests to the agent', () => {
    expect(needsAgent('帮我总结一下 Obsidian 里的笔记')).toBe(true)
    expect(needsAgent('删除桌面上的临时文件')).toBe(true)
  })

  it('still treats a leading ! as a command in any language', () => {
    expect(needsAgent('!dir ~')).toBe(false)
    expect(isCommandMessage('!shell dir')).toBe(true)
  })
})
