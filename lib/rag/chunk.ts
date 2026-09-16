/**
 * Fragmentation du corpus de politiques.
 *
 * Le decoupage suit la structure du document : chaque paragraphe devient un
 * fragment, rattache au titre de section (`##`) qui le precede. Les fragments
 * restent ainsi autonomes et citables comme source dans l'interface.
 */

export interface PolicyChunk {
  chunkKey: string;
  sourceSection: string | null;
  content: string;
}

const MIN_CHUNK_CHARS = 40;

export function chunkPolicies(markdown: string): PolicyChunk[] {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const chunks: PolicyChunk[] = [];
  let currentSection: string | null = null;
  let buffer: string[] = [];
  let index = 0;

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (content.length < MIN_CHUNK_CHARS) return;
    if (/^#{1,6}\s/.test(content) && content.split('\n').length === 1) return;
    chunks.push({
      chunkKey: `policy-${String(index).padStart(3, '0')}`,
      sourceSection: currentSection,
      content,
    });
    index += 1;
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      if (heading[1].length >= 2) {
        currentSection = heading[2].trim();
      }
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();

  return chunks;
}
