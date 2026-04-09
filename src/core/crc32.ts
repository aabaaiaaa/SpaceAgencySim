/**
 * crc32.ts — CRC-32 checksum using a lookup-table approach.
 *
 * Uses the standard CRC-32 polynomial 0xEDB88320 (bit-reversed representation
 * of 0x04C11DB7). The 256-entry lookup table is computed once at module load
 * time. Pure function, no dependencies, no side effects.
 *
 * @module core/crc32
 */

// ---------------------------------------------------------------------------
// Lookup table (computed once at module load)
// ---------------------------------------------------------------------------

/** Pre-computed CRC-32 table using polynomial 0xEDB88320. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
    table[i] = crc;
  }
  return table;
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the CRC-32 checksum of a byte array.
 *
 * @param data - The input bytes to checksum.
 * @returns The CRC-32 value as an unsigned 32-bit integer.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
