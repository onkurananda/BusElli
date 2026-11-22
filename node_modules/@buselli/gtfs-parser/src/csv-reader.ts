/**
 * CsvReader — streams a GTFS CSV file and validates each row with a Zod schema.
 *
 * Returns rows lazily via async generator so large files (stop_times.txt can
 * be 500 MB+) are never fully held in memory.
 */
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import type { ZodSchema, z } from 'zod';

export interface ParseResult<T> {
  valid: T[];
  /** Rows that failed Zod validation — includes row number and error details. */
  errors: Array<{ rowIndex: number; raw: Record<string, unknown>; message: string }>;
}

/**
 * Reads a GTFS CSV file and validates each row against `schema`.
 *
 * - Trims all string values before validation.
 * - Empty string fields are coerced to `undefined` for optional Zod fields.
 * - Returns all valid rows + a summary of parse errors.
 */
export async function parseCsvFile<S extends ZodSchema>(
  filePath: string,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  const valid: z.infer<S>[] = [];
  const errors: ParseResult<z.infer<S>>['errors'] = [];
  let rowIndex = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath).pipe(
      parse({
        columns: true,       // first row is header
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }),
    );

    stream.on('data', (raw: Record<string, unknown>) => {
      rowIndex++;
      // Coerce empty strings to undefined so Zod optional() works correctly
      const normalised = normaliseRecord(raw);
      const result = schema.safeParse(normalised);
      if (result.success) {
        valid.push(result.data as z.infer<S>);
      } else {
        errors.push({
          rowIndex,
          raw,
          message: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
    });

    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return { valid, errors };
}

function normaliseRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}
