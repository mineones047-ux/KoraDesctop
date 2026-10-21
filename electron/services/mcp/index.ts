/**
 * Everything the MCP layer exposes, in one place.
 *
 * The renderer reaches MCP only through the manager; the client and the wire protocol are
 * internals. Importing from the barrel is what keeps the `protocol.ts` types from leaking
 * into UI code that has no business knowing about JSON-RPC framing.
 */
export { MCPClient } from './client'
export { MCPConfig, defaultServers } from './config'
export { MCPManager } from './manager'
export type { MCPServerConfig, MCPConfigFile } from './config'
export type { MCPServerStatus, MCPToolWithServer } from './manager'
export type {
  MCPTool,
  MCPCallToolResult,
  MCPInitializeResult,
  MCPListToolsResult,
} from './protocol'
export { MCP_PROTOCOL_VERSION, MCP_ERROR_CODES } from './protocol'
