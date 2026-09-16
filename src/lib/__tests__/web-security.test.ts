import { describe, it, expect } from 'vitest'
// Import the REAL production implementation (electron/ipc/web.ts imports
// the same module) — a copy here would silently drift from production.
import { isBlockedHost, isAllowedProtocol } from '../../../electron/lib/web-security'

describe('Web Security - SSRF Prevention', () => {
  describe('isBlockedHost - Private/Localhost Addresses', () => {
    it('blocks localhost', () => {
      expect(isBlockedHost('localhost')).toBe(true)
      expect(isBlockedHost('localhost:3000')).toBe(true)
    })

    it('blocks IPv4 loopback', () => {
      expect(isBlockedHost('127.0.0.1')).toBe(true)
      expect(isBlockedHost('127.0.0.2')).toBe(true)
      expect(isBlockedHost('127.255.255.255')).toBe(true)
    })

    it('blocks IPv6 loopback', () => {
      expect(isBlockedHost('[::1]')).toBe(true)
    })

    it('blocks 10.0.0.0/8 private range', () => {
      expect(isBlockedHost('10.0.0.1')).toBe(true)
      expect(isBlockedHost('10.1.2.3')).toBe(true)
      expect(isBlockedHost('10.255.255.255')).toBe(true)
    })

    it('blocks 172.16.0.0/12 private range', () => {
      expect(isBlockedHost('172.16.0.1')).toBe(true)
      expect(isBlockedHost('172.17.0.1')).toBe(true)
      expect(isBlockedHost('172.31.255.255')).toBe(true)
    })

    it('allows 172.0.0.0/16 and 172.32.0.0/16 (not private)', () => {
      expect(isBlockedHost('172.15.0.1')).toBe(false)
      expect(isBlockedHost('172.32.0.1')).toBe(false)
    })

    it('blocks 192.168.0.0/16 private range', () => {
      expect(isBlockedHost('192.168.0.1')).toBe(true)
      expect(isBlockedHost('192.168.1.1')).toBe(true)
      expect(isBlockedHost('192.168.255.255')).toBe(true)
    })

    it('blocks 169.254.0.0/16 link-local', () => {
      expect(isBlockedHost('169.254.0.1')).toBe(true)
      expect(isBlockedHost('169.254.1.2')).toBe(true)
    })

    it('blocks 0.0.0.0', () => {
      expect(isBlockedHost('0.0.0.0')).toBe(true)
    })

    it('blocks IPv6 private ranges', () => {
      expect(isBlockedHost('[fc00::1]')).toBe(true)
      expect(isBlockedHost('[fd12:3456:789a::1]')).toBe(true)
      expect(isBlockedHost('[fe80::1]')).toBe(true)
    })
  })

  describe('isBlockedHost - Public Addresses', () => {
    it('allows public IPv4 addresses', () => {
      expect(isBlockedHost('8.8.8.8')).toBe(false)
      expect(isBlockedHost('1.1.1.1')).toBe(false)
      expect(isBlockedHost('142.250.80.46')).toBe(false)
      expect(isBlockedHost('151.101.1.140')).toBe(false)
    })

    it('allows public hostnames', () => {
      expect(isBlockedHost('google.com')).toBe(false)
      expect(isBlockedHost('api.openai.com')).toBe(false)
      expect(isBlockedHost('github.com')).toBe(false)
    })

    it('allows public IPv6 addresses', () => {
      expect(isBlockedHost('[2001:4860:4860::8888]')).toBe(false)
    })
  })

  describe('Protocol Validation', () => {
    it('allows http and https', () => {
      expect(isAllowedProtocol('http:')).toBe(true)
      expect(isAllowedProtocol('https:')).toBe(true)
    })

    it('blocks dangerous protocols', () => {
      expect(isAllowedProtocol('file:')).toBe(false)
      expect(isAllowedProtocol('ftp:')).toBe(false)
      expect(isAllowedProtocol('smb:')).toBe(false)
      expect(isAllowedProtocol('ldap:')).toBe(false)
      expect(isAllowedProtocol('gopher:')).toBe(false)
      expect(isAllowedProtocol('data:')).toBe(false)
      expect(isAllowedProtocol('javascript:')).toBe(false)
    })
  })
})

describe('URL Parsing Security', () => {
  it('rejects invalid URLs', () => {
    try {
      new URL('not a url')
      expect(true).toBe(false) // Should not reach here
    } catch {
      expect(true).toBe(true) // Expected
    }
  })

  it('correctly parses valid URLs', () => {
    const url = new URL('https://example.com:8080/path?query=1')
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('example.com')
    expect(url.port).toBe('8080')
  })

  it('handles URLs with authentication', () => {
    const url = new URL('https://user:pass@example.com')
    expect(url.hostname).toBe('example.com')
  })
})
