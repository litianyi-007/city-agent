import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviewConfiguration, printReport, runDoctor } from './doctor.mjs';

export function buildLaunchSpec(options, environment = process.env) {
  return { command: process.execPath, args: ['--import', 'tsx', path.join(options.root, 'server', 'index.ts')], options: {
    cwd: options.root, stdio: 'inherit', shell: false,
    env: { ...environment, PORT: String(options.port), CITY_AGENT_DATA_DIR: options.dataDir },
  } };
}

export async function launchReview(options, dependencies = {}) {
  const report = await (dependencies.doctor ?? runDoctor)(options);
  (dependencies.print ?? printReport)(report, false);
  if (!report.ready) return report.exitCode;
  const spec = buildLaunchSpec(options);
  console.log(`启动本机评委实例：http://127.0.0.1:${options.port}/#research`);
  console.log(`独立数据目录：${options.dataDir}；启动不会调用模型，Key 请在页面填写。停止：Ctrl+C。`);
  // The server uses the exact Node executable that passed the checks, no shell,
  // global tsx/dsh, installation, port fallback, or copied credentials.
  const child = (dependencies.spawn ?? spawn)(spec.command, spec.args, spec.options);
  return await new Promise(resolve => {
    const stop = signal => { if (!child.killed) child.kill(signal); };
    const onInterrupt = () => stop('SIGINT');
    const onTerminate = () => stop('SIGTERM');
    const cleanup = () => { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('error', () => { cleanup(); console.error('启动失败。检查本机运行时与源码依赖；未自动安装或换端口。'); resolve(1); });
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReviewConfiguration(process.env, process.argv.slice(2));
    if (options.help) console.log('用法：npm run start:review -- [--port 4320] [--data-dir 独立目录]。先只读自检，失败不启动、不安装、不换端口。');
    else process.exitCode = await launchReview(options);
  } catch (error) {
    console.error(`配置错误：${error.message}`);
    process.exitCode = 2;
  }
}
