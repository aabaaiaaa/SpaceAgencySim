/**
 * saveEncoding.ts — Pure functions for encoding/decoding save payloads.
 *
 * Owns the side-effect-free portion of the save pipeline: envelope
 * build/parse, CRC32, LZ-string compression, and payload validation.
 * The IndexedDB I/O layer lives in `saveload.ts`.
 *
 * @module core/saveEncoding
 */

import { crc32 } from './crc32.ts';

export { crc32 } from './crc32.ts';

// ---------------------------------------------------------------------------
// Binary Envelope Format (for export/import only — not internal storage)
// ---------------------------------------------------------------------------
// Bytes 0-3:   Magic bytes "SASV" (Space Agency Save, ASCII)
// Bytes 4-5:   Format version (uint16, big-endian)
// Bytes 6-9:   CRC-32 checksum of the payload (uint32, big-endian)
// Bytes 10-13: Payload length in bytes (uint32, big-endian)
// Bytes 14+:   Payload (LZC-compressed JSON string, UTF-8 encoded)
// ---------------------------------------------------------------------------

/** Magic bytes identifying the binary save envelope ("SASV" in ASCII). */
export const ENVELOPE_MAGIC = new Uint8Array([0x53, 0x41, 0x53, 0x56]); // S, A, S, V

/** Size of the binary envelope header in bytes. */
export const ENVELOPE_HEADER_SIZE = 14;

/** Current binary envelope format version. */
export const ENVELOPE_FORMAT_VERSION = 1;

/**
 * Builds a binary envelope around a payload string.
 *
 * Layout:
 *   [4 bytes magic] [2 bytes version (uint16 BE)] [4 bytes CRC-32 (uint32 BE)]
 *   [4 bytes payload length (uint32 BE)] [payload bytes]
 *
 * @param payload - The LZC-compressed save string to wrap.
 * @returns The complete envelope as a Uint8Array.
 */
export function buildBinaryEnvelope(payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const checksum = crc32(payloadBytes);

  const envelope = new Uint8Array(ENVELOPE_HEADER_SIZE + payloadBytes.length);
  const view = new DataView(envelope.buffer);

  // Magic bytes (0-3)
  envelope.set(ENVELOPE_MAGIC, 0);
  // Format version (4-5), uint16 big-endian
  view.setUint16(4, ENVELOPE_FORMAT_VERSION, false);
  // CRC-32 checksum (6-9), uint32 big-endian
  view.setUint32(6, checksum, false);
  // Payload length (10-13), uint32 big-endian
  view.setUint32(10, payloadBytes.length, false);
  // Payload (14+)
  envelope.set(payloadBytes, ENVELOPE_HEADER_SIZE);

  return envelope;
}

/**
 * Checks whether the first 4 bytes of a Uint8Array match the SASV magic bytes.
 */
export function hasMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < ENVELOPE_HEADER_SIZE) return false;
  return (
    bytes[0] === ENVELOPE_MAGIC[0] &&
    bytes[1] === ENVELOPE_MAGIC[1] &&
    bytes[2] === ENVELOPE_MAGIC[2] &&
    bytes[3] === ENVELOPE_MAGIC[3]
  );
}

/**
 * Parses a binary envelope, validating header fields and CRC-32 checksum,
 * and returns the UTF-8-decoded payload string (typically LZC-compressed JSON).
 *
 * Caller is responsible for checking magic bytes first (via {@link hasMagicBytes}).
 *
 * @throws {Error} If the envelope version is newer than supported, the payload
 *   length does not match the remaining bytes, or the CRC-32 checksum fails.
 */
export function parseBinaryEnvelope(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Read header fields.
  const version = view.getUint16(4, false);
  if (version > ENVELOPE_FORMAT_VERSION) {
    throw new Error(
      'Save was created with a newer version of the game. ' +
      `Please update to load this save (save version: ${version}, supported: ${ENVELOPE_FORMAT_VERSION}).`
    );
  }
  const expectedCrc = view.getUint32(6, false);
  const payloadLength = view.getUint32(10, false);

  // Validate payload length matches actual remaining bytes.
  const actualPayloadLength = bytes.length - ENVELOPE_HEADER_SIZE;
  if (payloadLength !== actualPayloadLength) {
    throw new Error(
      `Import failed: save file is corrupted (payload length mismatch — ` +
      `header says ${payloadLength} bytes, file contains ${actualPayloadLength}).`
    );
  }

  // Extract and verify payload.
  const payloadBytes = bytes.slice(ENVELOPE_HEADER_SIZE);
  const actualCrc = crc32(payloadBytes);
  if (expectedCrc !== actualCrc) {
    throw new Error('Import failed: save file is corrupted (CRC-32 checksum mismatch).');
  }

  // Decode payload as UTF-8.
  const decoder = new TextDecoder();
  return decoder.decode(payloadBytes);
}
