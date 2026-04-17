/**
 * saveEncoding.ts — Pure functions for encoding/decoding save payloads.
 *
 * Owns the side-effect-free portion of the save pipeline: envelope
 * build/parse, CRC32, LZ-string compression, and payload validation.
 * The IndexedDB I/O layer lives in `saveload.ts`.
 *
 * @module core/saveEncoding
 */

export { crc32 } from './crc32.ts';
