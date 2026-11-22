import { describe, it, expect } from 'vitest';
import { gtfsTimeToSeconds, GtfsStopRowSchema, GtfsStopTimeRowSchema } from '../src/schemas.js';

describe('gtfsTimeToSeconds', () => {
  it('converts standard HH:MM:SS to seconds', () => {
    expect(gtfsTimeToSeconds('07:00:00')).toBe(25200);
    expect(gtfsTimeToSeconds('00:00:00')).toBe(0);
    expect(gtfsTimeToSeconds('23:59:59')).toBe(86399);
  });

  it('handles post-midnight GTFS times (hours > 23)', () => {
    // GTFS spec allows 24:05:00 for 5 minutes past midnight on the next service day
    expect(gtfsTimeToSeconds('24:05:00')).toBe(86700);
    expect(gtfsTimeToSeconds('25:30:00')).toBe(91800);
  });

  it('throws on malformed time strings', () => {
    expect(() => gtfsTimeToSeconds('07:00')).toThrow();
    expect(() => gtfsTimeToSeconds('not-a-time')).toThrow();
    expect(() => gtfsTimeToSeconds('')).toThrow();
  });

  it('throws when minutes or seconds are out of range', () => {
    expect(() => gtfsTimeToSeconds('07:60:00')).toThrow();
    expect(() => gtfsTimeToSeconds('07:00:60')).toThrow();
  });
});

describe('GtfsStopRowSchema', () => {
  it('parses a valid stop row', () => {
    const row = { stop_id: 'BLR001', stop_name: 'Silk Board', stop_lat: '12.9165', stop_lon: '77.6209' };
    const result = GtfsStopRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stop_lat).toBeCloseTo(12.9165, 4);
    }
  });

  it('rejects a stop with invalid latitude', () => {
    const row = { stop_id: 'BLR001', stop_name: 'Silk Board', stop_lat: '95', stop_lon: '77.6209' };
    expect(GtfsStopRowSchema.safeParse(row).success).toBe(false);
  });

  it('rejects a stop with empty stop_id', () => {
    const row = { stop_id: '', stop_name: 'Silk Board', stop_lat: '12.9165', stop_lon: '77.6209' };
    expect(GtfsStopRowSchema.safeParse(row).success).toBe(false);
  });
});

describe('GtfsStopTimeRowSchema', () => {
  it('parses a valid stop_time row', () => {
    const row = {
      trip_id: 'trip_001',
      stop_id: 'BLR001',
      stop_sequence: '3',
      arrival_time: '07:14:00',
      departure_time: '07:15:00',
    };
    expect(GtfsStopTimeRowSchema.safeParse(row).success).toBe(true);
  });

  it('accepts post-midnight arrival times', () => {
    const row = {
      trip_id: 'trip_001',
      stop_id: 'BLR001',
      stop_sequence: '3',
      arrival_time: '24:05:00',
      departure_time: '24:06:00',
    };
    expect(GtfsStopTimeRowSchema.safeParse(row).success).toBe(true);
  });

  it('rejects malformed time format', () => {
    const row = {
      trip_id: 'trip_001',
      stop_id: 'BLR001',
      stop_sequence: '3',
      arrival_time: '7:00',
      departure_time: '7:01',
    };
    expect(GtfsStopTimeRowSchema.safeParse(row).success).toBe(false);
  });
});
