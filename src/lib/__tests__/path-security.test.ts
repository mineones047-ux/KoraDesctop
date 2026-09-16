import { describe, it, expect } from 'vitest'
import { validatePath, validatePathRead } from '../path-security'

describe('validatePath', () => {
  it('rejects empty paths', () => {
    expect(validatePath('')).toBe('Path is empty')
    expect(validatePath('   ')).toBe('Path is empty')
  })

  it('rejects null bytes', () => {
    expect(validatePath('C:\\Users\\test\0.txt')).toBeTruthy()
  })

  it('rejects root paths', () => {
    expect(validatePath('C:\\')).toBeTruthy()
    expect(validatePath('C:')).toBeTruthy()
    expect(validatePath('/')).toBeTruthy()
  })

  it('rejects Windows system directories', () => {
    expect(validatePath('C:\\Windows')).toBeTruthy()
    expect(validatePath('C:\\Windows\\System32')).toBeTruthy()
    expect(validatePath('C:\\Program Files')).toBeTruthy()
    expect(validatePath('C:\\ProgramData')).toBeTruthy()
  })

  it('rejects Linux system directories', () => {
    // FIXED: normalizePath preserves leading slash for absolute paths
    expect(validatePath('/etc')).toBeTruthy()
    expect(validatePath('/etc/passwd')).toBeTruthy()
    expect(validatePath('/boot')).toBeTruthy()
    expect(validatePath('/proc')).toBeTruthy()
    expect(validatePath('/sys')).toBeTruthy()
    expect(validatePath('/dev')).toBeTruthy()
  })

  it('allows user directories', () => {
    expect(validatePath('C:\\Users\\test\\Documents')).toBeNull()
    expect(validatePath('~/projects')).toBeNull()
    expect(validatePath('/home/user/projects')).toBeNull()
  })

  it('handles path traversal attempts', () => {
    // This normalizes .. components
    const result = validatePath('C:\\Users\\test\\..\\..\\Windows')
    expect(result).toBeTruthy()
  })
})

describe('validatePathRead', () => {
  it('allows paths within allowed directories', () => {
    const allowed = ['C:\\Users\\test\\projects']
    expect(validatePathRead('C:\\Users\\test\\projects\\file.txt', allowed)).toBeNull()
    expect(validatePathRead('C:\\Users\\test\\projects\\subdir\\file.txt', allowed)).toBeNull()
  })

  it('rejects paths outside allowed directories', () => {
    const allowed = ['C:\\Users\\test\\projects']
    expect(validatePathRead('C:\\Users\\test\\Desktop\\file.txt', allowed)).toBeTruthy()
    expect(validatePathRead('C:\\Windows\\file.txt', allowed)).toBeTruthy()
  })

  it('rejects empty paths', () => {
    expect(validatePathRead('', ['C:\\Users'])).toBe('Path is empty')
  })

  it('rejects null bytes', () => {
    expect(validatePathRead('C:\\Users\0.txt', ['C:\\Users'])).toBeTruthy()
  })
})
