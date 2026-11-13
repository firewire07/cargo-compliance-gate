import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function loadCatalog<T>(fileName: string): T {
  const candidates = [
    process.env.SCREENING_DATA_DIR
      ? join(process.env.SCREENING_DATA_DIR, fileName)
      : '',
    // webpack bundle: data copied next to main.js
    join(__dirname, 'data', fileName),
    // ts-jest / src: ../../data from src/rules
    join(__dirname, '../../data', fileName),
    join(process.cwd(), 'apps/screening-svc/data', fileName),
  ].filter(Boolean);

  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error(
      `Screening catalog ${fileName} not found. Looked in: ${candidates.join(', ')}`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
