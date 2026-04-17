/**
 * saveEncoding.test.ts — Unit tests for the pure encoding/decoding helpers.
 *
 * Covers the side-effect-free portion of the save pipeline extracted in
 * TASK-047..050: envelope build/parse, CRC32 known values, LZ-string
 * compress/decompress round-trips, and payload validation (happy path
 * plus each rejection branch).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  COMPRESSED_PREFIX,
  ENVELOPE_FORMAT_VERSION,
  ENVELOPE_HEADER_SIZE,
  ENVELOPE_MAGIC,
  buildBinaryEnvelope,
  compressSaveData,
  crc32,
  decompressSaveData,
  hasMagicBytes,
  parseBinaryEnvelope,
  _validateNestedStructures,
  _validateState,
} from '../core/saveEncoding.ts';
import { logger } from '../core/logger.ts';

// ---------------------------------------------------------------------------
// Helper: construct a minimal-but-valid deserialised state for _validateState
// ---------------------------------------------------------------------------

function validState(): Record<string, unknown> {
  return {
    money: 100,
    playTimeSeconds: 0,
    loan: { balance: 0, interestRate: 0.05 },
    crew: [],
    rockets: [],
    parts: [],
    flightHistory: [],
    missions: { available: [], accepted: [], completed: [] },
  };
}

// ---------------------------------------------------------------------------
// LZ-string compress/decompress
// ---------------------------------------------------------------------------

describe('compressSaveData / decompressSaveData', () => {
  it('round-trips arbitrary JSON string @smoke', () => {
    const json = JSON.stringify({ a: 1, b: 'hello', c: [1, 2, 3], d: { nested: true } });
    const compressed = compressSaveData(json);
    expect(compressed.startsWith(COMPRESSED_PREFIX)).toBe(true);
    expect(decompressSaveData(compressed)).toBe(json);
  });

  it('round-trips the empty string', () => {
    const compressed = compressSaveData('');
    expect(compressed.startsWith(COMPRESSED_PREFIX)).toBe(true);
    expect(decompressSaveData(compressed)).toBe('');
  });

  it('round-trips a large repetitive payload', () => {
    const json = JSON.stringify({ blob: 'x'.repeat(10_000) });
    const compressed = compressSaveData(json);
    // Compression should actually shrink a highly repetitive input.
    expect(compressed.length).toBeLessThan(json.length);
    expect(decompressSaveData(compressed)).toBe(json);
  });

  it('decompressSaveData throws on input missing the compressed prefix', () => {
    expect(() => decompressSaveData('{"plain":"json"}')).toThrow(
      /missing the compressed prefix/i,
    );
  });

  it('decompressSaveData throws when the compressed body is corrupt', () => {
    // Valid prefix, but body is not a valid lz-string UTF-16 stream.
    expect(() => decompressSaveData(`${COMPRESSED_PREFIX}\u0001\u0002\u0003`)).toThrow(
      /decompress/i,
    );
  });
});

// ---------------------------------------------------------------------------
// CRC-32 known values (re-exported from saveEncoding)
// ---------------------------------------------------------------------------

describe('crc32 (re-exported from saveEncoding)', () => {
  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches the standard "123456789" check value 0xCBF43926', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xCBF43926);
  });

  it('returns 0xA505DF1B for a single 0x01 byte', () => {
    expect(crc32(new Uint8Array([0x01]))).toBe(0xA505DF1B);
  });
});

// ---------------------------------------------------------------------------
// Envelope build/parse
// ---------------------------------------------------------------------------

describe('buildBinaryEnvelope / parseBinaryEnvelope', () => {
  it('writes the SASV magic bytes, version, CRC, and length into the header', () => {
    const payload = 'hello world';
    const envelope = buildBinaryEnvelope(payload);
    const payloadBytes = new TextEncoder().encode(payload);

    // Magic bytes 0-3: "SASV"
    expect(envelope[0]).toBe(ENVELOPE_MAGIC[0]);
    expect(envelope[1]).toBe(ENVELOPE_MAGIC[1]);
    expect(envelope[2]).toBe(ENVELOPE_MAGIC[2]);
    expect(envelope[3]).toBe(ENVELOPE_MAGIC[3]);

    const view = new DataView(envelope.buffer);
    // Version (4-5)
    expect(view.getUint16(4, false)).toBe(ENVELOPE_FORMAT_VERSION);
    // CRC (6-9) matches crc32(payload)
    expect(view.getUint32(6, false)).toBe(crc32(payloadBytes));
    // Payload length (10-13)
    expect(view.getUint32(10, false)).toBe(payloadBytes.length);
    // Total size
    expect(envelope.length).toBe(ENVELOPE_HEADER_SIZE + payloadBytes.length);
  });

  it('round-trips an arbitrary payload through build → parse', () => {
    const payload = 'the quick brown fox jumps over the lazy dog';
    const envelope = buildBinaryEnvelope(payload);
    expect(hasMagicBytes(envelope)).toBe(true);
    expect(parseBinaryEnvelope(envelope)).toBe(payload);
  });

  it('round-trips a Unicode payload (multi-byte UTF-8)', () => {
    const payload = 'héllo 🚀 世界';
    const envelope = buildBinaryEnvelope(payload);
    expect(parseBinaryEnvelope(envelope)).toBe(payload);
  });

  it('hasMagicBytes returns false for too-short input', () => {
    expect(hasMagicBytes(new Uint8Array(4))).toBe(false);
  });

  it('hasMagicBytes returns false for mismatched magic', () => {
    const bytes = new Uint8Array(ENVELOPE_HEADER_SIZE);
    bytes[0] = 0x00;
    bytes[1] = 0x00;
    bytes[2] = 0x00;
    bytes[3] = 0x00;
    expect(hasMagicBytes(bytes)).toBe(false);
  });

  it('parseBinaryEnvelope throws on newer-than-supported version', () => {
    const envelope = buildBinaryEnvelope('payload');
    const view = new DataView(envelope.buffer);
    view.setUint16(4, ENVELOPE_FORMAT_VERSION + 1, false);
    expect(() => parseBinaryEnvelope(envelope)).toThrow(/newer version/i);
  });

  it('parseBinaryEnvelope throws on payload-length mismatch', () => {
    const envelope = buildBinaryEnvelope('payload');
    const view = new DataView(envelope.buffer);
    view.setUint32(10, 9999, false); // claim far more bytes than actually present
    expect(() => parseBinaryEnvelope(envelope)).toThrow(/payload length mismatch/i);
  });

  it('parseBinaryEnvelope throws on CRC mismatch', () => {
    const envelope = buildBinaryEnvelope('payload');
    // Flip one byte of the payload (after the 14-byte header) to break the CRC
    // without changing the payload length.
    envelope[ENVELOPE_HEADER_SIZE] ^= 0x01;
    expect(() => parseBinaryEnvelope(envelope)).toThrow(/CRC-32 checksum mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// _validateState
// ---------------------------------------------------------------------------

describe('_validateState', () => {
  beforeEach(() => {
    // Silence the warn() calls emitted by the nested validation path.
    logger.setLevel('error');
  });

  it('accepts a well-formed minimal state', () => {
    expect(() => _validateState(validState())).not.toThrow();
  });

  it('throws when money is not a number', () => {
    const s = validState();
    s.money = 'lots';
    expect(() => _validateState(s)).toThrow(/money/i);
  });

  it('throws when playTimeSeconds is not a number', () => {
    const s = validState();
    s.playTimeSeconds = null;
    expect(() => _validateState(s)).toThrow(/playTimeSeconds/i);
  });

  it('throws when loan is missing', () => {
    const s = validState();
    delete (s as { loan?: unknown }).loan;
    expect(() => _validateState(s)).toThrow(/loan/i);
  });

  it('throws when loan is an array', () => {
    const s = validState();
    s.loan = [];
    expect(() => _validateState(s)).toThrow(/loan/i);
  });

  it('throws when loan.balance is not a number', () => {
    const s = validState();
    s.loan = { balance: 'zero', interestRate: 0 };
    expect(() => _validateState(s)).toThrow(/loan\.balance/i);
  });

  it('throws when loan.interestRate is not a number', () => {
    const s = validState();
    s.loan = { balance: 0, interestRate: null };
    expect(() => _validateState(s)).toThrow(/loan\.interestRate/i);
  });

  it.each(['crew', 'rockets', 'parts', 'flightHistory'])(
    'throws when %s is not an array',
    (field) => {
      const s = validState();
      (s as Record<string, unknown>)[field] = {};
      expect(() => _validateState(s)).toThrow(new RegExp(field));
    },
  );

  it('throws when missions is missing', () => {
    const s = validState();
    delete (s as { missions?: unknown }).missions;
    expect(() => _validateState(s)).toThrow(/missions/i);
  });

  it('throws when missions is an array', () => {
    const s = validState();
    s.missions = [];
    expect(() => _validateState(s)).toThrow(/missions/i);
  });

  it.each(['available', 'accepted', 'completed'])(
    'throws when missions.%s is not an array',
    (bucket) => {
      const s = validState();
      s.missions = { available: [], accepted: [], completed: [] };
      (s.missions as Record<string, unknown>)[bucket] = 'nope';
      expect(() => _validateState(s)).toThrow(new RegExp(`missions\\.${bucket}`));
    },
  );

  it('filters corrupted nested entries during validation', () => {
    const s = validState();
    s.missions = {
      available: [],
      accepted: [{ id: 'ok', title: 'Ok', reward: 1 }, { id: 123 }],
      completed: [],
    };
    _validateState(s);
    expect((s.missions as { accepted: unknown[] }).accepted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// _validateNestedStructures
// ---------------------------------------------------------------------------

describe('_validateNestedStructures', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  it('is a no-op on empty collections', () => {
    const s = validState();
    expect(() => _validateNestedStructures(s)).not.toThrow();
  });

  it('filters out missions.accepted entries with missing fields', () => {
    const s = validState();
    (s.missions as { accepted: unknown[] }).accepted = [
      { id: 'a', title: 'A', reward: 10 }, // valid
      null,                                 // invalid: not an object
      { id: 'b', title: 'B' },              // invalid: missing reward
      { id: 1, title: 'C', reward: 3 },     // invalid: id not a string
    ];
    _validateNestedStructures(s);
    const accepted = (s.missions as { accepted: unknown[] }).accepted;
    expect(accepted).toHaveLength(1);
    expect((accepted[0] as { id: string }).id).toBe('a');
  });

  it('filters out crew entries with missing name/status/skills', () => {
    const s = validState();
    s.crew = [
      { name: 'Alice', status: 'ready', skills: { piloting: 1 } }, // valid
      { name: 'Bob', status: null, skills: {} },                    // invalid status
      { name: 'Carol', status: 'ready', skills: [] },               // skills must be object, not array
      { name: 42, status: 'ready', skills: {} },                    // invalid name
    ];
    _validateNestedStructures(s);
    expect((s.crew as unknown[]).length).toBe(1);
  });

  it('filters out orbitalObjects entries with missing id/bodyId/elements', () => {
    const s = validState() as Record<string, unknown>;
    s.orbitalObjects = [
      { id: 'sat-1', bodyId: 'earth', elements: { a: 1 } }, // valid
      { id: 'sat-2', bodyId: 'earth' },                     // missing elements
      { id: 'sat-3', bodyId: 'earth', elements: [] },       // elements is an array
    ];
    _validateNestedStructures(s);
    expect((s.orbitalObjects as unknown[]).length).toBe(1);
  });

  it('filters out savedDesigns entries with missing name/parts', () => {
    const s = validState() as Record<string, unknown>;
    s.savedDesigns = [
      { name: 'Rocket 1', parts: [] }, // valid
      { name: 'Rocket 2' },             // missing parts
      { parts: [] },                    // missing name
    ];
    _validateNestedStructures(s);
    expect((s.savedDesigns as unknown[]).length).toBe(1);
  });

  it('filters out contracts.active entries with missing id/reward', () => {
    const s = validState() as Record<string, unknown>;
    s.contracts = {
      active: [
        { id: 'c-1', reward: 100 }, // valid
        { id: 'c-2' },              // missing reward
        { reward: 50 },             // missing id
      ],
    };
    _validateNestedStructures(s);
    expect(((s.contracts as { active: unknown[] }).active).length).toBe(1);
  });
});
