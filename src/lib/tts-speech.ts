/**
 * Text preparation for TTS.
 *
 * Reading raw markdown aloud is unpleasant: a URL gets spelled out letter by letter, and
 * a code block turns into a stream of punctuation. This module rewrites the text into
 * something a voice can say, and splits it into chunks that fit the service's limits.
 *
 * Pure and dependency-free so the vitest suite exercises the exact text that gets spoken.
 */

/** Placeholder words substituted for unreadable content, per language. */
export interface SpeechWords {
  link: string
  code: string
  image: string
}

const RU_WORDS: SpeechWords = { link: 'ссылка', code: 'фрагмент кода', image: 'изображение' }
const EN_WORDS: SpeechWords = { link: 'link', code: 'code snippet', image: 'image' }

/**
 * Choose placeholder words from the voice's locale.
 *
 * Russian and Ukrainian share `ru`; everyone else gets English. Deriving it from the
 * *voice* rather than the UI language is deliberate — a user can run an English UI with a
 * Russian voice, and the placeholders then match what is actually being read aloud.
 */
export function speechWordsForVoice(voice: string): SpeechWords {
  return voice.startsWith('ru') || voice.startsWith('uk') ? RU_WORDS : EN_WORDS
}

/**
 * Strip markdown noise and cap the length.
 *
 * `maxLen` is a real constraint, not a guard rail: the Edge endpoint rejects very long
 * inputs, and a truncated answer is better than a failed synthesis.
 */
export function normalizeForSpeech(input: string, words: SpeechWords, maxLen = 4000): string {
  let t = input

  // fenced code blocks → placeholder
  t = t.replace(/```[\s\S]*?(?:```|$)/g, ` ${words.code}. `)
  // inline code
  t = t.replace(/`([^`\n]+)`/g, '$1')
  // images ![alt](url) → drop
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ` ${words.image}. `)
  // markdown links [text](url) → text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // bare URLs → placeholder
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ` ${words.link}. `)

  // headings
  t = t.replace(/^#{1,6}\s+/gm, '')
  // bold / italic / strikethrough
  t = t.replace(/(\*\*\*|___)(\S[^*_\n]*?\2)/g, '$2')
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1')
  t = t.replace(/__([^_\n]+)__/g, '$1')
  t = t.replace(/\*([^*\n]+)\*/g, '$1')
  t = t.replace(/_([^_\n]+)_/g, '$1')
  t = t.replace(/~~([^~\n]+)~~/g, '$1')

  // blockquotes
  t = t.replace(/^\s*>\s?/gm, '')

  // tables: keep cell text, drop separator rows
  t = t.replace(/^\s*\|?[\s:-]*-{2,}[\s|:-]*\|\s*$/gm, '')
  t = t.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
      .join('. '),
  )

  // list bullets / task checkboxes
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
  t = t.replace(/^\s*-\s\[(?:x| )\]\s*/gim, '')

  // horizontal rules
  t = t.replace(/^\s*([-*_]\s*){3,}$/gm, '')

  // raw HTML tags
  t = t.replace(/<[^>\n]+>/g, ' ')

  // emoji & pictographs
   
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    '',
  )

  // collapse whitespace
  t = t.replace(/[ \t]+/g, ' ')
  t = t.replace(/\n{3,}/g, '\n\n')
  t = t.trim()

  if (t.length > maxLen) {
    const cut = t.lastIndexOf('.', maxLen)
    t = (cut > maxLen / 2 ? t.slice(0, cut + 1) : t.slice(0, maxLen)) + ' …'
  }
  return t
}

/**
 * Split into chunks at sentence boundaries so long answers start playing
 * quickly and synthesis stays cheap.
 */
export function splitForSpeech(text: string, maxLen = 700): string[] {
  if (text.length <= maxLen) {
    return text.trim() ? [text.trim()] : []
  }

  // protect common abbreviations from being treated as sentence ends
  const guarded = text.replace(/\b([а-яё]|mr|mrs|ms|dr|st|etc|e\.g|i\.e)\./gi, '$1\u0000')

  const parts: string[] = []
  let buf = ''
  const sentences = guarded.split(/(?<=[.!?…;:])\s+|\n+/)

  for (const s of sentences) {
    const sentence = s.replace(/\u0000/g, '.').trim()
    if (!sentence) continue
    if ((buf + ' ' + sentence).trim().length > maxLen && buf) {
      parts.push(buf.trim())
      buf = sentence
    } else {
      buf = (buf ? buf + ' ' : '') + sentence
    }
    // single over-long "sentence": hard-slice it
    while (buf.length > maxLen * 1.5) {
      const cut = Math.round(maxLen * 1.2)
      const commaCut = buf.lastIndexOf(',', cut)
      const at = commaCut > cut / 2 ? commaCut : cut
      parts.push(buf.slice(0, at).trim())
      buf = buf.slice(at).trim()
    }
  }
  if (buf.trim()) parts.push(buf.trim())
  return parts.filter(Boolean)
}
