import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_VERSION = '0.1.5-rc.3';
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = (id, status, message, remediation, details) => ({ id, status, message, ...(remediation ? { remediation } : {}), ...(details ? { details } : {}) });

export function checkNodeVersion(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.replace(/^v/, ''));
  const supported = parsed && (Number(parsed[1]) > 22 || (Number(parsed[1]) === 22 && Number(parsed[2]) >= 19));
  return supported
    ? check('node', 'pass', `Node ${version} 满足 22.19.0 最低要求。`, undefined, { validatedVersion: '22.22.3' })
    : check('node', 'fail', `Node ${version} 不满足 22.19.0 最低要求。`, '安装 Node 22.22.3；使用 nvm 时执行 nvm install && nvm use，重新打开终端并确认 node --version。');
}

export function parseReviewConfiguration(env = process.env, args = [], root = PROJECT_ROOT) {
  let portText = env.PORT || '4320';
  let dataDir = env.CITY_AGENT_DATA_DIR || path.join(root, '.city-agent-review');
  let json = false;
  let help = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--json') json = true;
    else if (args[index] === '--help') help = true;
    else if (args[index] === '--port' || args[index] === '--data-dir') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('参数 --port/--data-dir 必须有值。');
      if (args[index - 1] === '--port') portText = value;
      else dataDir = value;
    } else throw new Error(`未知参数：${args[index]}。支持 --json、--port、--data-dir、--help。`);
  }
  if (!/^[1-9]\d{0,4}$/.test(portText) || Number(portText) > 65535) throw new Error('PORT/--port 必须是 1–65535 的整数。');
  if (!dataDir.trim()) throw new Error('CITY_AGENT_DATA_DIR/--data-dir 不得为空。');
  const directory = path.resolve(root, dataDir);
  if ([path.parse(directory).root, path.resolve(root), path.resolve(homedir())].includes(directory)) {
    throw new Error('数据目录必须是专用子目录，不能是文件系统根目录、项目根目录或用户主目录。');
  }
  return { root: path.resolve(root), port: Number(portText), dataDir: directory, json, help };
}

export function checkHarnessManifests(sdk, runtime, binaryExists) {
  if (sdk.version !== HARNESS_VERSION || runtime.version !== HARNESS_VERSION || sdk.dependencies?.['@deepseek-ai/dsh'] !== HARNESS_VERSION) {
    return check('harness', 'fail', 'SDK 与其实际解析的 dsh 必须同时为 0.1.5-rc.3。', '使用项目 package-lock.json 执行 npm ci；不要安装全局 dsh 或单独升级 SDK。', { sdk: sdk.version ?? null, runtime: runtime.version ?? null });
  }
  if (!binaryExists) return check('harness', 'fail', '同版 dsh 缺少发布的运行入口。', '检查完整源码安装目录并重新执行 npm ci；不要用申报材料 ZIP 代替源码。');
  return check('harness', 'pass', `SDK 与实际解析的 dsh 均为 ${HARNESS_VERSION}；发布入口存在。`);
}

export async function checkHarnessRuntime(root) {
  try {
    const projectRequire = createRequire(path.join(root, 'package.json'));
    const sdkPath = projectRequire.resolve('@deepseek-ai/dsh-sdk-client/package.json');
    // Resolve from the SDK's own location, matching its installed runtime lookup.
    const runtimePath = createRequire(sdkPath).resolve('@deepseek-ai/dsh/package.json');
    const sdk = JSON.parse(await readFile(sdkPath, 'utf8'));
    const runtime = JSON.parse(await readFile(runtimePath, 'utf8'));
    const bin = typeof runtime.bin === 'string' ? runtime.bin : runtime.bin?.dsh;
    const binExists = typeof bin === 'string' && await stat(path.resolve(path.dirname(runtimePath), bin)).then(value => value.isFile(), () => false);
    return checkHarnessManifests(sdk, runtime, binExists);
  } catch {
    return check('harness', 'fail', '无法解析项目内的 Harness SDK/dsh。', '在源码根目录使用 Node 22.22.3 执行 npm ci。');
  }
}

export async function checkBuiltFrontend(root) {
  try {
    const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
    const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]).filter(value => value.startsWith('/assets/'));
    if (!assetPaths.some(value => value.endsWith('.js'))) throw new Error('No built JavaScript');
    for (const asset of assetPaths) {
      const filename = path.resolve(root, 'dist', asset.slice(1));
      if (!filename.startsWith(`${path.resolve(root, 'dist', 'assets')}${path.sep}`) || !(await stat(filename)).isFile()) throw new Error('Invalid built asset');
    }
    return check('build', 'pass', '本机 dist/index.html 和引用的构建资源存在。', undefined, { limitation: '仅检查文件完整性，不证明构建与当前源码同步。' });
  } catch {
    return check('build', 'fail', '本机构建缺失或资源不完整；dist-pages 不可替代 dist。', '执行 npm run build 后重新自检。');
  }
}

export function probePort(port) {
  return new Promise(resolve => {
    const server = createServer();
    const timer = setTimeout(() => { server.close(); resolve(check('port', 'fail', `无法在限定时间检查回环端口 ${port}。`, '检查本机防火墙/权限，或显式指定另一独立端口。')); }, 2000);
    server.once('error', error => {
      clearTimeout(timer);
      resolve(check('port', 'fail', error.code === 'EADDRINUSE' ? `回环端口 ${port} 已被占用。` : `回环端口 ${port} 无法绑定（${error.code || 'unknown'}）。`, '不要终止其他项目服务；使用 --port 或 PORT 显式指定空闲端口。'));
    });
    server.listen(port, '127.0.0.1', () => server.close(() => {
      clearTimeout(timer);
      resolve(check('port', 'pass', `回环端口 ${port} 当前可用。`, undefined, { limitation: '检查释放后仍存在端口竞态；实际启动失败时不自动换端口。' }));
    }));
  });
}

async function checkDataDirectory(directory) {
  let ancestor = directory;
  for (;;) {
    try {
      const metadata = await stat(ancestor);
      if (!metadata.isDirectory()) return check('data-directory', 'fail', '数据目录或最近存在的父路径不是目录。', '显式指定独立、可写的专用数据目录。');
      await access(ancestor, constants.W_OK);
      return check('data-directory', 'pass', '专用数据目录或其现有父目录可写；自检未创建目录或读取配置。', undefined, { limitation: '不读取数据库/密钥，不验证已有数据目录是否被另一服务持有；服务启动另有所有权检查。' });
    } catch (error) {
      if (error.code !== 'ENOENT') return check('data-directory', 'fail', '数据目录前提检查失败。', '检查目录权限或显式指定新的专用数据目录。');
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return check('data-directory', 'fail', '找不到可用的数据目录父路径。', '指定独立、可写的专用数据目录。');
      ancestor = parent;
    }
  }
}

export async function runDoctor(options = {}) {
  const { root = PROJECT_ROOT, port = 4320, dataDir = path.join(root, '.city-agent-review'), nodeVersion = process.versions.node, platform = process.platform, probes = {} } = options;
  const checks = [checkNodeVersion(nodeVersion)];
  checks.push(platform === 'darwin'
    ? check('platform', 'pass', '项目实测环境：macOS / Node 22.22.3。', undefined, { currentPlatform: platform, currentArch: process.arch })
    : check('platform', 'warning', `${platform} 尚未完成本项目干净机器实测。`, '可以继续按具体检查结果复现；不能把代码可运行等同于该系统已验收。'));
  checks.push(await (probes.harness ?? checkHarnessRuntime)(root));
  if (checks[0].status === 'fail') checks.push(check('sqlite', 'warning', 'Node 版本不满足要求，未加载 node:sqlite。', '先切换到 Node 22.22.3。'));
  else {
    try {
      const sqlite = await (probes.sqlite ?? (() => import('node:sqlite')))();
      if (typeof sqlite.DatabaseSync !== 'function') throw new Error('DatabaseSync missing');
      checks.push(check('sqlite', 'pass', 'node:sqlite DatabaseSync 可导入；未创建任何数据库。'));
    } catch {
      checks.push(check('sqlite', 'fail', '无法导入 node:sqlite DatabaseSync。', '使用完整的 Node 22.22.3 发行版；不要以 Node 20 或禁用内置 SQLite 的运行时启动。'));
    }
  }
  checks.push(await checkBuiltFrontend(root));
  try {
    const chromiumPath = probes.chromiumPath ? await probes.chromiumPath() : createRequire(path.join(root, 'package.json'))('playwright').chromium.executablePath();
    if (!(await stat(chromiumPath)).isFile()) throw new Error('Missing Chromium');
    checks.push(check('chromium', 'pass', 'Playwright 对应的 Chromium 文件存在；未安装或启动浏览器。', undefined, { limitation: '文件存在不证明可启动，尤其不验证 Linux 共享库。' }));
  } catch {
    checks.push(check('chromium', 'fail', 'Playwright 对应的 Chromium 未找到。', '显式执行 npm run setup 下载 Chromium；Linux 缺共享库时按指南由管理员检查系统依赖。'));
  }
  checks.push(await (probes.port ?? probePort)(port));
  checks.push(await checkDataDirectory(dataDir));
  const exitCode = checks.some(value => value.status === 'fail') ? 1 : 0;
  return { schemaVersion: '1.0', ready: exitCode === 0, exitCode, checkedAt: new Date().toISOString(), root, port, dataDir, checks,
    limitations: ['不读取密钥/私有配置，不创建数据库，不安装依赖或浏览器，不请求模型。', '本自检不证明模型权限、CORS、真实答卷质量或四角色交付 Gate 通过。'] };
}

export function printReport(report, json = false) {
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`City Agent 评委环境自检：${report.ready ? '就绪' : '未就绪'}（exit ${report.exitCode}）`);
    for (const item of report.checks) console.log(`[${item.status.toUpperCase()}] ${item.id}: ${item.message}${item.remediation ? `\n  修复：${item.remediation}` : ''}`);
    console.log('自检只检查本机前提，不证明真实模型调用或产品全部验收通过。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReviewConfiguration(process.env, process.argv.slice(2));
    if (options.help) console.log('用法：npm run doctor -- [--json] [--port 4320] [--data-dir 独立目录]；退出码 0=就绪，1=检查失败，2=参数错误。');
    else {
      const report = await runDoctor(options);
      printReport(report, options.json);
      process.exitCode = report.exitCode;
    }
  } catch (error) {
    console.log(JSON.stringify({ schemaVersion: '1.0', ready: false, exitCode: 2, error: error.message }));
    process.exitCode = 2;
  }
}
