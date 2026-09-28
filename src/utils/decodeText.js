// Els fitxers d'Untis i de GestIB poden arribar en UTF-8, en UTF-16 o en
// Windows-1252 ("ANSI"), sovint sense declarar-ho. Llegir-los sempre com a
// UTF-8 converteix Ñ, À, Í... en el caràcter de substitució «�».

const LATIN1_LABELS = /iso-8859-1|latin-?1|windows-1252|cp1252/;

export function decodeUploadedText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  const header = new TextDecoder('windows-1252').decode(bytes.subarray(0, 300));
  const declared = (header.match(/encoding=["']([^"']+)/i)?.[1] || '').toLowerCase();
  if (!hasUtf8Bom && LATIN1_LABELS.test(declared)) return new TextDecoder('windows-1252').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Un fitxer desat abans d'aquesta correcció pot haver perdut caràcters.
export function hasEncodingDamage(text) {
  return String(text || '').includes('�');
}
