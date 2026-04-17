/**
 * saveEncoding.ts — Pure functions for encoding/decoding save payloads.
 *
 * Owns the side-effect-free portion of the save pipeline: envelope
 * build/parse, CRC32, LZ-string compression, and payload validation.
 * The IndexedDB I/O layer lives in `saveload.ts`.
 *
 * @module core/saveEncoding
 */

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { crc32 } from './crc32.ts';
import { logger } from './logger.ts';

export { crc32 } from './crc32.ts';

// ---------------------------------------------------------------------------
// LZ-String Compression Wrappers
// ---------------------------------------------------------------------------

/**
 * Prefix marker for compressed save strings in storage.
 * Compressed saves are stored as: COMPRESSED_PREFIX + compressToUTF16(json).
 * This allows callers to detect compressed vs uncompressed data.
 */
export const COMPRESSED_PREFIX = 'LZC:';

/**
 * Compresses a JSON string for storage using lz-string UTF-16 encoding.
 * Returns the compressed string with a prefix marker for detection.
 */
export function compressSaveData(json: string): string {
  return COMPRESSED_PREFIX + compressToUTF16(json);
}

/**
 * Decompresses a storage string back to JSON.
 * Throws if the compressed prefix is missing (corrupt data).
 */
export function decompressSaveData(raw: string): string {
  if (!raw.startsWith(COMPRESSED_PREFIX)) {
    throw new Error('Save data is missing the compressed prefix — possibly corrupt.');
  }
  const decompressed = decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length));
  if (decompressed === null) {
    throw new Error('Failed to decompress save data');
  }
  return decompressed;
}

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

// ---------------------------------------------------------------------------
// Payload Validation (post-parse, any-typed guards)
// ---------------------------------------------------------------------------

/**
 * Validates that an object looks like a serialised GameState.
 * Checks types of all top-level required fields; rejects on the first error.
 * Then validates critical nested structures, filtering out corrupted entries
 * rather than failing the entire load.
 *
 * Exported with an underscore prefix so it can be tested independently;
 * treat it as an internal implementation detail.
 *
 * @throws {Error} Describing the first validation failure found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validates untrusted deserialized JSON
export function _validateState(state: any): void {
  // Numeric top-level fields.
  for (const field of ['money', 'playTimeSeconds']) {
    if (typeof state[field] !== 'number') {
      throw new Error(
        `Import failed: state.${field} must be a number; got ${typeof state[field]}.`
      );
    }
  }

  // Loan object.
  if (!state.loan || typeof state.loan !== 'object' || Array.isArray(state.loan)) {
    throw new Error('Import failed: state.loan must be a plain object.');
  }
  if (typeof state.loan.balance !== 'number') {
    throw new Error('Import failed: state.loan.balance must be a number.');
  }
  if (typeof state.loan.interestRate !== 'number') {
    throw new Error('Import failed: state.loan.interestRate must be a number.');
  }

  // Array fields.
  for (const field of ['crew', 'rockets', 'parts', 'flightHistory']) {
    if (!Array.isArray(state[field])) {
      throw new Error(`Import failed: state.${field} must be an array.`);
    }
  }

  // Missions sub-object.
  if (!state.missions || typeof state.missions !== 'object' || Array.isArray(state.missions)) {
    throw new Error('Import failed: state.missions must be a plain object.');
  }
  for (const field of ['available', 'accepted', 'completed']) {
    if (!Array.isArray(state.missions[field])) {
      throw new Error(`Import failed: state.missions.${field} must be an array.`);
    }
  }

  // Filter corrupted nested entries (shared with loadGame).
  _validateNestedStructures(state);
}

/**
 * Validates critical nested array structures within a game state,
 * filtering out corrupted entries rather than failing the entire load/import.
 * Logs a warning for each collection that had entries removed.
 *
 * Safe to call on partially-migrated state (missing arrays are skipped).
 *
 * Exported with an underscore prefix for testing; treat as internal.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validates untrusted deserialized JSON
export function _validateNestedStructures(state: any): void {
  // Missions: accepted and completed entries must have id (string), title (string), reward (number).
  if (state.missions && typeof state.missions === 'object') {
    for (const bucket of ['accepted', 'completed']) {
      if (!Array.isArray(state.missions[bucket])) continue;
      const original = state.missions[bucket];
      const filtered = original.filter((entry: Record<string, unknown>) => {
        if (!entry || typeof entry !== 'object') return false;
        if (typeof entry.id !== 'string') return false;
        if (typeof entry.title !== 'string') return false;
        if (typeof entry.reward !== 'number') return false;
        return true;
      });
      if (filtered.length < original.length) {
        const removed = original.length - filtered.length;
        logger.warn('save', `Filtered ${removed} corrupted entries from missions.${bucket}`, {
          originalCount: original.length,
          keptCount: filtered.length,
        });
        state.missions[bucket] = filtered;
      }
    }
  }

  // Crew: each entry must have name (string), status (defined), skills (object).
  if (Array.isArray(state.crew)) {
    const original = state.crew;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.name !== 'string') return false;
      if (entry.status === undefined || entry.status === null) return false;
      if (!entry.skills || typeof entry.skills !== 'object' || Array.isArray(entry.skills)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from crew`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.crew = filtered;
    }
  }

  // Orbital objects: each entry must have id (string), bodyId (string), elements (object).
  if (Array.isArray(state.orbitalObjects)) {
    const original = state.orbitalObjects;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.id !== 'string') return false;
      if (typeof entry.bodyId !== 'string') return false;
      if (!entry.elements || typeof entry.elements !== 'object' || Array.isArray(entry.elements)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from orbitalObjects`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.orbitalObjects = filtered;
    }
  }

  // Saved designs: each entry must have name (string), parts (array).
  if (Array.isArray(state.savedDesigns)) {
    const original = state.savedDesigns;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.name !== 'string') return false;
      if (!Array.isArray(entry.parts)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from savedDesigns`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.savedDesigns = filtered;
    }
  }

  // Contracts active: each entry must have id (string), reward (number).
  if (state.contracts && typeof state.contracts === 'object' && Array.isArray(state.contracts.active)) {
    const original = state.contracts.active;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.id !== 'string') return false;
      if (typeof entry.reward !== 'number') return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from contracts.active`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.contracts.active = filtered;
    }
  }
}
