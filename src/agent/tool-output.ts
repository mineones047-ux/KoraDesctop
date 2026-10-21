/**
 * Tool output sanitisation and delimiting (security review 2026-09-25 —
 * partial fix for the long-standing "prompt injection via tool results"
 * limitation in SECURITY_FIXES.md / PROJECT_HANDOFF §13).
 *
 * Tool/file/web output is untrusted DATA: it may contain text that pretends
 * to be user or system instructions. Two defences:
 * 1. wrapToolOutput() puts every observation between explicit <tool_output>
 *    markers, and the system prompt tells the model that this region is data
 *    and never instructions;
 * 2. sanitizeToolOutput() strips ANSI/control sequences (which could hide or
 *    rewrite previously displayed instructions) and bounds the length.
 *
 * Pure module: no React, no window, no Node — imported by the orchestrator
 * and by vitest.
 */

/** Longest tool output kept after sanitisation (chars). */
export const MAX_TOOL_OUTPUT = 20000

export function sanitizeToolOutput(text: string): string {
  return (
    String(text)
      // ANSI CSI sequences (colour/cursor) and OSC sequences (title etc.)
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
      .replace(/\u001b./g, '')
      // Control characters except \t \n \r (0x09 0x0a 0x0d)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, MAX_TOOL_OUTPUT)
  )
}

export function wrapToolOutput(text: string): string {
  return `<tool_output>\n${sanitizeToolOutput(text)}\n</tool_output>`
}