import { validateUploadMetadata, type UploadMetadata } from '@agentfit/contracts';
import { AppError } from '../http/errors';
export function validateInputBytes(data: Uint8Array, input: UploadMetadata): UploadMetadata {
  const metadata = validateUploadMetadata(input);
  if (data.byteLength !== metadata.size) throw new AppError('SIZE_MISMATCH');
  const types = metadata.kind === 'pdf' ? ['application/pdf', 'application/octet-stream'] : metadata.kind === 'markdown' ? ['text/markdown', 'application/octet-stream'] : ['text/plain', 'application/octet-stream'];
  if (!types.includes(metadata.contentType)) throw new AppError('MIME_MISMATCH');
  if (metadata.kind === 'pdf') {
    if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-') throw new AppError('INVALID_PDF');
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new AppError('INVALID_UTF8'); }
    if (text.includes('\0')) throw new AppError('INVALID_TEXT');
    if (!text.trim()) throw new AppError('EMPTY_DOCUMENT');
  }
  return metadata;
}
