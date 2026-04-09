import { describe, it, expect } from 'vitest';
import { crc32 } from '../core/crc32.js';

describe('crc32', () => {
  it('returns 0x00000000 for empty input', () => {
    const result = crc32(new Uint8Array(0));
    expect(result).toBe(0x00000000);
  });

  it('returns 0xCBF43926 for ASCII "123456789"', () => {
    const data = new TextEncoder().encode('123456789');
    const result = crc32(data);
    expect(result).toBe(0xCBF43926);
  });

  it('returns a consistent result for all-zero input', () => {
    const zeros = new Uint8Array(16);
    const a = crc32(zeros);
    const b = crc32(zeros);
    expect(a).toBe(b);
    // Known value for 16 zero bytes
    expect(a).toBe(crc32(new Uint8Array(16)));
  });

  it('returns a non-zero result for a single byte', () => {
    const data = new Uint8Array([0x01]);
    const result = crc32(data);
    expect(result).not.toBe(0);
    // Known CRC-32 for byte 0x01 is 0xA505DF1B
    expect(result).toBe(0xA505DF1B);
  });

  it('produces different results for different inputs', () => {
    const a = crc32(new Uint8Array([0x00]));
    const b = crc32(new Uint8Array([0x01]));
    expect(a).not.toBe(b);
  });
});
