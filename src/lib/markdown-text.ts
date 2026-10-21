/**
 * Flatten a React node subtree into plain text.
 *
 * Used by the markdown renderer to hand a fenced code block's raw source to the
 * "copy code" button (react-markdown gives the `pre` element a `code` child
 * whose `children` is the code string, possibly wrapped in an array). Pure and
 * dependency-free so the vitest suite covers it (convention: test the exact code
 * that runs in production).
 */
export function nodeText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (node === null || node === undefined) return ''

  if (Array.isArray(node)) return node.map(nodeText).join('')

  if (typeof node === 'object') {
    const props = (node as { props?: { children?: unknown } }).props
    if (props && 'children' in props) return nodeText(props.children)
  }

  return ''
}
