/**
 * Application configuration + IPC handlers (config:get / config:set).
 *
 * Stored in ~/.kora/config.json and written atomically (tmp + rename, mode 0600,
 * serialised through a write queue). API keys are encrypted with Electron
 * safeStorage and stored with the `enc:` prefix; legacy plaintext keys migrate on
 * the first save. set() whitelists keys, validates types and clamps values.
 */
import { ipcMain, safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

interface CustomProvider {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

interface ConfigData {
  provider: string
  lmstudioUrl: string
  ollamaUrl: string
  llamacppUrl?: string
  selectedModel: string
  apiKey: string
  apiBaseUrl: string
  apiModel: string
  customProviders: CustomProvider[]
  systemPrompt: string
  temperature: number
  agentDecisionModel?: string
  agentDecisionProvider?: string
  activeTemplate: string
  ttsVoice: string
  theme: string
  language: string
  obsidianVaultPath: string
  graphLinkColor: string
  graphNodeColor: string
  sttEngine?: string
  whisperPath?: string
  whisperModel?: string
}

const DEFAULT_CONFIG: ConfigData = {
  provider: 'lmstudio',
  lmstudioUrl: 'http://localhost:1234',
  ollamaUrl: 'http://localhost:11434',
  llamacppUrl: 'http://localhost:8080',
  selectedModel: '',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com',
  apiModel: 'gpt-3.5-turbo',
  customProviders: [],
  systemPrompt: 'You are Kora, a helpful AI assistant. Be concise and clear in your responses.',
  temperature: 0.7,
  agentDecisionModel: '',
  agentDecisionProvider: '',
  activeTemplate: 'default',
  ttsVoice: 'ru-RU-DmitryNeural',
  theme: 'red',
  language: 'en',
  obsidianVaultPath: '',
  graphLinkColor: '',
  graphNodeColor: '',
  sttEngine: 'webspeech',
  whisperPath: '',
  whisperModel: '',
}

const ENC_PREFIX = 'enc:'

function encryptSecret(plain: string): string {
  if (!plain) return plain
  if (safeStorage.isEncryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  }
  return plain
}

function decryptSecret(stored: string): string {
  if (!stored) return stored
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      return ''
    }
  }
  return stored
}

class Config {
  private data: ConfigData = { ...DEFAULT_CONFIG }
  private configPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor() {
    this.configPath = path.join(os.homedir(), '.kora', 'config.json')
  }

  async load() {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(content)
      const { maxTokens: _legacyMaxTokens, ...savedConfig } = parsed
      this.data = { ...DEFAULT_CONFIG, ...savedConfig }
      // Remove the retired output-token setting from existing profiles.
      let needsRewrite = Object.prototype.hasOwnProperty.call(parsed, 'maxTokens')
      if (this.data.apiKey && !this.data.apiKey.startsWith(ENC_PREFIX) && safeStorage.isEncryptionAvailable()) {
        needsRewrite = true
      }
      this.data.apiKey = decryptSecret(this.data.apiKey)
      // Decrypt per-provider keys stored with the enc: prefix; legacy plaintext keys stay readable but will be encrypted on next save
      this.data.customProviders = (this.data.customProviders || []).map((p) => ({
        ...p,
        apiKey: decryptSecret(p.apiKey),
      }))
      if (needsRewrite) {
        await this.save()
      }
    } catch {
      this.data = { ...DEFAULT_CONFIG }
    }
  }

  async save(): Promise<void> {
    const run = async (): Promise<void> => {
      const dir = path.dirname(this.configPath)
      await fs.mkdir(dir, { recursive: true })
      const toWrite: Record<string, unknown> = {
        ...this.data,
        apiKey: encryptSecret(this.data.apiKey),
        customProviders: (this.data.customProviders || []).map((p) => ({
          ...p,
          apiKey: encryptSecret(p.apiKey),
        })),
      }
      const tmp = this.configPath + '.kora-' + crypto.randomBytes(6).toString('hex')
      await fs.writeFile(tmp, JSON.stringify(toWrite, null, 2), { encoding: 'utf-8', mode: 0o600 })
      await fs.rename(tmp, this.configPath)
    }
    const next = this.writeQueue.then(run, run)
    this.writeQueue = next.catch((err) => {
      console.error('[KORA] config persist error:', err)
    })
    return next
  }

  get(): ConfigData {
    return { ...this.data }
  }

  set(key: string, value: unknown) {
    const expectedType: Record<string, string> = {
      provider: 'string',
      lmstudioUrl: 'string',
      ollamaUrl: 'string',
      llamacppUrl: 'string',
      selectedModel: 'string',
      apiKey: 'string',
      apiBaseUrl: 'string',
      apiModel: 'string',
      systemPrompt: 'string',
      temperature: 'number',
      agentDecisionModel: 'string',
      agentDecisionProvider: 'string',
      activeTemplate: 'string',
      ttsVoice: 'string',
      theme: 'string',
      language: 'string',
      obsidianVaultPath: 'string',
      customProviders: 'object',
      graphLinkColor: 'string',
      graphNodeColor: 'string',
      sttEngine: 'string',
      whisperPath: 'string',
      whisperModel: 'string',
    }
    const type = expectedType[key]
    if (!type) return
    if (type === 'number') {
      if (typeof value !== 'number' || !isFinite(value)) return
      if (key === 'temperature') value = Math.max(0, Math.min(2, value))
    } else if (type === 'object') {
      if (!Array.isArray(value)) return
      if (key === 'customProviders') {
        value = (value as unknown[]).filter(
          (p): p is { name: string; baseUrl: string; apiKey: string; model: string } =>
            !!p && typeof p === 'object' &&
            typeof (p as any).name === 'string' &&
            typeof (p as any).baseUrl === 'string' &&
            typeof (p as any).apiKey === 'string' &&
            typeof (p as any).model === 'string',
        )
      }
    } else if (typeof value !== 'string') {
      return
    }
    if ((key === 'graphLinkColor' || key === 'graphNodeColor') && value !== '' && !/^#[0-9a-fA-F]{6}$/.test(value as string)) return
    if (key === 'obsidianVaultPath' && typeof value === 'string') {
      value = value.trim().replace(/^["']|["']$/g, '').replace(/["']/g, '').trim()
    }
    ;(this.data as any)[key] = value
    this.save()
  }
}

export const config = new Config()

export function registerConfigHandlers() {
  ipcMain.handle('config:get', () => config.get())
  ipcMain.handle('config:set', (_event, key: string, value: unknown) => config.set(key, value))
}