import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { productionEnvironment } from '../config/production-environment.js';
const { root } = productionEnvironment();
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
writeFileSync(path.join(root, 'dist', 'production-build.json'), JSON.stringify({ platformCommit: git('rev-parse', 'HEAD'), sourceClean: !git('status', '--porcelain'), builtAt: new Date().toISOString() }, null, 2));
