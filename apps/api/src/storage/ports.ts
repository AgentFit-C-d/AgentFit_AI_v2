import type { InputRef, UploadMetadata } from '@agentfit/contracts';
export interface TemporaryInputStore {
  readonly storage: InputRef['storage'];
  allocate(metadata: UploadMetadata): InputRef;
  write(ref: InputRef, data: Uint8Array, metadata: UploadMetadata): Promise<void>;
  put(data: Uint8Array, metadata: UploadMetadata): Promise<InputRef>;
  read(ref: InputRef): Promise<Uint8Array>;
  delete(ref: InputRef): Promise<void>;
}
export const MAX_UPLOAD_BYTES = 10_485_760;
