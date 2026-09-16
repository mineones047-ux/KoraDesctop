import { APIClient } from './api'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

const DEFAULT_BASE_URL = 'http://localhost:1234'

/**
 * Thin wrapper over APIClient for OpenAI-compatible local servers
 * (LM Studio, Ollama). No API key required.
 */
export class LMStudioClient {
  static async chat(
    messages: ChatMessage[],
    baseUrl?: string,
    temperature?: number,
  ): Promise<string> {
    return APIClient.chat(messages, '', baseUrl || DEFAULT_BASE_URL, '', 'lmstudio', temperature)
  }

  static async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    baseUrl?: string,
    temperature?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return APIClient.chatStream(messages, onChunk, '', baseUrl || DEFAULT_BASE_URL, '', 'lmstudio', temperature, signal)
  }

  static async listModels(baseUrl?: string): Promise<string[]> {
    return APIClient.listModels(baseUrl || DEFAULT_BASE_URL, '', 'lmstudio')
  }

  static async testConnection(baseUrl?: string): Promise<{ success: boolean; error?: string }> {
    return APIClient.testConnection('', baseUrl || DEFAULT_BASE_URL, 'lmstudio')
  }
}
