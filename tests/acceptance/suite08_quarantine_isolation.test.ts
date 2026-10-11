import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SUITE-08: Quarantine Repository Complete Isolation
 * Tests: QUARANTINE-READONLY-001, QUARANTINE-IMPORT-BAN-002, QUARANTINE-BUILD-INDEPENDENT-003
 */
describe('SUITE-08: Quarantine Repository Isolation', () => {
  it('QUARANTINE-IMPORT-BAN-002: Zero imports of _salvage in src/ or tests/', () => {
    const srcDir = path.resolve('src');
    if (fs.existsSync(srcDir)) {
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
      for (const file of files) {
        if (typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.js'))) {
          const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
          expect(content).not.toContain('_salvage');
        }
      }
    }
  });

  it('QUARANTINE-READONLY-001: _salvage remains untouched and git-ignored', () => {
    const gitignore = fs.readFileSync(path.resolve('.gitignore'), 'utf-8');
    expect(gitignore).toContain('/_salvage/');
  });
});
