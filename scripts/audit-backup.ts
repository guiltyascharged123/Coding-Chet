import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { auditBackup } from '../server/backup-audit.js';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(
    'Usage: npm run audit:backup -- <workspace-backup.json>\nRead-only: validates a backup and reports execution capabilities. No restore, model requests or project actions.',
  );
} else {
  try {
    if (args.length !== 1) throw new Error('Provide one backup path. Use --help for usage.');
    console.log(JSON.stringify(auditBackup(JSON.parse(readFileSync(args[0], 'utf8'))), null, 2));
  } catch (error) {
    console.error(
      error instanceof ZodError
        ? JSON.stringify({
            error: 'Backup validation failed.',
            issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          })
        : error instanceof SyntaxError
          ? 'The backup is not valid JSON.'
          : error instanceof Error
            ? error.message
            : 'Backup audit failed.',
    );
    process.exitCode = 1;
  }
}
