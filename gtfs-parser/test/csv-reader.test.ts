import { describe, it, expect, vi } from 'vitest';
import { parseCsvFile } from '../src/csv-reader.js';
import { GtfsStopRowSchema, GtfsRouteRowSchema, GtfsStopTimeRowSchema } from '../src/schemas.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeTmpCsv(content: string): string {
  const dir = join(tmpdir(), 'buselli-test-gtfs');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// ── parseCsvFile ──────────────────────────────────────────────────────────────

describe('parseCsvFile with GtfsStopRowSchema', () => {
  it('parses valid rows and returns them as valid', async () => {
    const csv = [
      'stop_id,stop_name,stop_lat,stop_lon',
      'BLR001,Silk Board Junction,12.9165,77.6209',
      'BLR002,Marathahalli Bridge,12.9560,77.7014',
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopRowSchema);

    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(0);
    expect(valid[0]?.stop_id).toBe('BLR001');
    expect(valid[1]?.stop_lat).toBeCloseTo(12.956, 3);
  });

  it('accumulates errors for invalid rows without discarding valid ones', async () => {
    const csv = [
      'stop_id,stop_name,stop_lat,stop_lon',
      'BLR001,Silk Board,12.9165,77.6209',   // valid
      ',Bad Stop,12.0,77.0',                   // invalid — empty stop_id
      'BLR003,KR Puram,13.0,77.7',            // valid
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopRowSchema);

    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.rowIndex).toBe(2);
  });

  it('treats empty string fields as undefined (optional field coercion)', async () => {
    const csv = [
      'stop_id,stop_name,stop_lat,stop_lon,stop_desc',
      'BLR001,Silk Board,12.9165,77.6209,',  // empty stop_desc → undefined
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopRowSchema);

    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(valid[0]?.stop_desc).toBeUndefined();
  });

  it('returns zero rows and zero errors for a CSV with only a header', async () => {
    const csv = 'stop_id,stop_name,stop_lat,stop_lon\n';
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopRowSchema);

    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('trims whitespace from values before validation', async () => {
    const csv = [
      'stop_id,stop_name,stop_lat,stop_lon',
      '  BLR001  ,  Silk Board  ,  12.9165  ,  77.6209  ',
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid } = await parseCsvFile(path, GtfsStopRowSchema);

    expect(valid[0]?.stop_id).toBe('BLR001');
    expect(valid[0]?.stop_name).toBe('Silk Board');
  });
});

describe('parseCsvFile with GtfsRouteRowSchema', () => {
  it('parses valid routes.txt rows', async () => {
    const csv = [
      'route_id,agency_id,route_short_name,route_long_name,route_type,route_color',
      '500D,BMTC,500D,Silk Board to KR Puram,3,0066CC',
      '335E,BMTC,335E,Majestic to Whitefield,3,',
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsRouteRowSchema);

    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(0);
    expect(valid[1]?.route_color).toBeUndefined();
  });
});

describe('parseCsvFile with GtfsStopTimeRowSchema', () => {
  it('parses valid stop_times.txt rows including post-midnight times', async () => {
    const csv = [
      'trip_id,stop_id,stop_sequence,arrival_time,departure_time,shape_dist_traveled',
      'trip001,BLR001,1,07:00:00,07:00:30,0',
      'trip001,BLR002,2,07:14:00,07:14:30,2500',
      'trip002,BLR001,1,24:05:00,24:05:30,0',  // post-midnight
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopTimeRowSchema);

    expect(valid).toHaveLength(3);
    expect(errors).toHaveLength(0);
    expect(valid[2]?.arrival_time).toBe('24:05:00');
  });

  it('records a parse error for a malformed time format', async () => {
    const csv = [
      'trip_id,stop_id,stop_sequence,arrival_time,departure_time',
      'trip001,BLR001,1,7:00,7:01',  // invalid — should be HH:MM:SS
    ].join('\n');
    const path = writeTmpCsv(csv);

    const { valid, errors } = await parseCsvFile(path, GtfsStopTimeRowSchema);

    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});
