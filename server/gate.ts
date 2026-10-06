import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { z } from 'zod';
import type { GateResult } from './types.js';

const selector = z.string().trim().min(1).max(200);
const value = z.string().max(5000);
const interactionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fill'), selector, value }).strict(),
  z.object({ action: z.literal('click'), selector, value: value.optional() }).strict(),
]);
const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fill'), selector, value }).strict(),
  z.object({ action: z.literal('click'), selector }).strict(),
  z.object({ action: z.literal('assertText'), selector, text: z.string().min(1).max(5000) }).strict(),
  z.object({ action: z.literal('assertVisible'), selector }).strict(),
  z.object({ action: z.literal('assertValue'), selector, value }).strict(),
  z.object({ action: z.literal('assertChanged'), selector, after: interactionSchema }).strict(),
]);
const checkSchema = z.object({
  name: z.string().trim().min(1).max(120),
  steps: z.array(stepSchema).min(1).max(20),
}).strict();

export type AcceptanceCheck = z.infer<typeof checkSchema>;

export const acceptanceSchema = z.array(checkSchema).min(2).max(12).superRefine((checks, ctx) => {
  const meaningful = checks.some((check) => {
    let interacted = false;
    return check.steps.some((step) => {
      if (step.action === 'assertChanged') return true;
      if (step.action === 'fill' || step.action === 'click') interacted = true;
      return interacted && (step.action === 'assertText' || step.action === 'assertValue');
    });
  });
  if (!meaningful) ctx.addIssue({ code: 'custom', message: '至少需要一条交互后文本/值断言，或 assertChanged；只有可见性检查不能验收功能。' });
});

const DOCUMENT_URL = 'https://city-agent.invalid/';
const CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
  'img-src data:', "connect-src 'none'", "worker-src 'none'", "frame-src 'none'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  'sandbox allow-scripts',
].join('; ');
const HTML_MAX_BYTES = 500_000;
const CHECK_TIMEOUT_MS = 5000;
const TOTAL_TIMEOUT_MS = 60_000;

function detail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 700);
}

async function bounded<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { if (timeout) clearTimeout(timeout); }
}

async function observedValue(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

async function interact(page: Page, step: z.infer<typeof interactionSchema>): Promise<void> {
  const locator = page.locator(step.selector);
  if (step.action === 'fill') await locator.fill(step.value);
  else await locator.click();
}

async function eventually(read: () => Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 1500;
  do {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  } while (Date.now() < deadline);
  throw new Error(description);
}

async function executeSteps(page: Page, steps: AcceptanceCheck['steps']): Promise<void> {
  for (const step of steps) {
    const locator = page.locator(step.selector);
    switch (step.action) {
      case 'fill': case 'click':
        await interact(page, step);
        break;
      case 'assertVisible':
        await locator.waitFor({ state: 'visible' });
        break;
      case 'assertText':
        await eventually(async () => (await locator.innerText()).includes(step.text), `${step.selector} 未显示预期文本：${step.text}`);
        break;
      case 'assertValue':
        await eventually(async () => await locator.inputValue() === step.value, `${step.selector} 的值不是 ${step.value}`);
        break;
      case 'assertChanged': {
        const before = await observedValue(locator);
        await interact(page, step.after);
        await eventually(async () => await observedValue(locator) !== before, `${step.selector} 在交互后没有改变。`);
        break;
      }
    }
  }
}

/**
 * Execute generated code only inside Chromium. Every check gets a fresh opaque
 * sandbox origin; the document is fulfilled in-memory, and all other requests
 * are rejected. The response CSP cannot be weakened by generated markup.
 */
export async function runGate(html: string, checks: AcceptanceCheck[], signal?: AbortSignal): Promise<GateResult> {
  signal?.throwIfAborted();
  const results: GateResult['checks'] = [];
  if (Buffer.byteLength(html, 'utf8') > HTML_MAX_BYTES || !/^\s*<!doctype\s+html\s*>/i.test(html) || !html.trim()) {
    return { passed: false, checks: [{ name: '静态 HTML 结构', passed: false, detail: '交付必须包含 HTML5 doctype，且不超过 500 KB。' }], summary: 'HTML 不满足可执行交付格式。' };
  }
  const parsed = acceptanceSchema.safeParse(checks);
  if (!parsed.success) {
    return { passed: false, checks: [{ name: '验收脚本', passed: false, detail: parsed.error.issues.map((issue) => issue.message).join('；') }], summary: '验收必须包含可观察的交互结果。' };
  }
  let browser: Browser | undefined;
  let stopping = false;
  let closePromise: Promise<void> | undefined;
  const closeBrowser = () => (closePromise ??= browser?.close() ?? Promise.resolve());
  let cancelListener: (() => void) | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    const stop = (error: Error) => {
      stopping = true;
      reject(error);
      if (browser) void closeBrowser().catch(() => undefined);
    };
    cancelListener = () => stop(new DOMException('浏览器验收已取消。', 'AbortError'));
    signal?.addEventListener('abort', cancelListener, { once: true });
    totalTimer = setTimeout(() => stop(new Error('浏览器验收超过 60 秒，已停止。')), TOTAL_TIMEOUT_MS);
  });

  const checkInPage = async (name: string, check: (page: Page) => Promise<void>) => {
    let context: BrowserContext | undefined;
    const faults: string[] = [];
    const recordFault = (message: string) => { if (faults.length < 16) faults.push(message); };
    try {
      await Promise.race([bounded((async () => {
        context = await browser!.newContext({
          // CSP's opaque sandbox + worker-src already prevent service workers.
          // Playwright's serviceWorkers:'block' injects navigator.serviceWorker
          // access, which itself throws inside this intentionally opaque origin.
          viewport: { width: 1280, height: 900 }, acceptDownloads: false,
        });
        let documentServed = false;
        await context.route('**/*', async (route) => {
          const request = route.request();
          if (!documentServed && request.isNavigationRequest() && request.url() === DOCUMENT_URL) {
            documentServed = true;
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': CSP }, body: html });
          } else {
            recordFault('页面尝试访问网络或跳转，已阻止。');
            await route.abort('blockedbyclient');
          }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(1500);
        page.setDefaultNavigationTimeout(2000);
        context.on('page', (popup) => {
          recordFault('页面尝试打开弹窗，已阻止。');
          void popup.close().catch(() => undefined);
        });
        page.on('pageerror', (error) => { recordFault(`JavaScript 错误：${detail(error)}`); });
        page.on('console', (message) => {
          if (message.type() === 'error') recordFault(`页面错误：${message.text().slice(0, 300)}`);
        });
        page.on('download', (download) => { recordFault('页面尝试下载文件，已阻止。'); void download.cancel().catch(() => undefined); });
        page.on('dialog', (dialog) => { recordFault('页面触发了阻塞对话框。'); void dialog.dismiss().catch(() => undefined); });
        await page.goto(DOCUMENT_URL, { waitUntil: 'load' });
        await check(page);
        // Let DOM update, promise callbacks and immediate JS errors settle.
        await page.waitForTimeout(50);
        if (page.url() !== DOCUMENT_URL) recordFault('页面发生了未授权导航。');
        if (faults.length) throw new Error(faults.slice(0, 3).join('；'));
      })(), CHECK_TIMEOUT_MS, '此验收项超过 5 秒。'), stopped]);
      results.push({ name, passed: true });
    } catch (error) {
      if (signal?.aborted || stopping) throw error;
      results.push({ name, passed: false, detail: detail(error) });
    } finally { await context?.close().catch(() => undefined); }
  };

  try {
    const launch = chromium.launch({ headless: true, timeout: 15_000, args: ['--js-flags=--max-old-space-size=128'] }).then(async (launched) => {
      browser = launched;
      if (stopping) { await closeBrowser(); throw new Error('浏览器验收已停止。'); }
      return launched;
    });
    await Promise.race([launch, stopped]);
    await checkInPage('页面加载、可见内容与 JavaScript', async (page) => {
      if (!(await page.title()).trim()) throw new Error('页面缺少非空 title。');
      if (!(await page.locator('body').isVisible()) || !(await page.locator('body').innerText()).trim()) {
        throw new Error('页面没有可见正文。');
      }
    });
    for (const check of parsed.data) await checkInPage(check.name, (page) => executeSteps(page, check.steps));
    const passed = results.every((result) => result.passed);
    return { passed, checks: results, summary: passed ? '独立 Chromium 验收通过，交互与输出已验证。' : '浏览器验收未通过，需修复失败项。' };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('浏览器验收已取消。', 'AbortError');
    const message = detail(error);
    results.push({ name: 'Chromium 运行环境', passed: false, detail: /Executable doesn't exist|playwright install/.test(message) ? '缺少 Playwright Chromium。请运行 npm run setup 后重试。' : message });
    return { passed: false, checks: results, summary: '浏览器未完成验收；没有将交付标记为通过。' };
  } finally {
    if (totalTimer) clearTimeout(totalTimer);
    if (cancelListener) signal?.removeEventListener('abort', cancelListener);
    if (browser) await closeBrowser().catch(() => undefined);
  }
}
