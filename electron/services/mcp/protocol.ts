/**
 * MCP (Model Context Protocol) — protocol types.
 * Spec: https://modelcontextprotocol.io/specification/2024-11-05
 *
 * Only the subset needed for tool discovery and invocation is modeled here.
 * The wire format is JSON-RPC 2.0 over newline-delimited stdio.
 */

export interface MCPRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: MCPError
  method?: string
  params?: unknown
}

export interface MCPError {
  code: number
  message: string
  data?: unknown
}

export interface MCPNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export interface MCPServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  logging?: Record<string, never>
}

export interface MCPServerInfo {
  name: string
  version: string
}

export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: MCPServerCapabilities
  serverInfo: MCPServerInfo
  instructions?: string
}

export interface MCPToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface MCPToolInputSchema {
  type: 'object'
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
}

export interface JsonSchemaNode {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null'
  description?: string
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  [k: string]: unknown
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema: MCPToolInputSchema
  annotations?: MCPToolAnnotations
}

export interface MCPListToolsResult {
  tools: MCPTool[]
  nextCursor?: string
}

export interface MCPCallToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; text?: string; mimeType?: string } }
  >
  isError?: boolean
}

export const MCP_PROTOCOL_VERSION = '2024-11-05'

export const MCP_ERROR_CODES = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  RequestTimeout: -32000,
  ServerNotInitialized: -32002,
  UnknownError: -32001,
} as const
