import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { ProductionStore } from './store.js';

const DOCUMENT_URL = 'https://city-agent-preview.invalid/';
const MAX_HTML_BYTES = 500_000;
const MAX_PNG_BYTES = 5_000_000;
const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts";

/**
 * Generate a static image in a short-lived, request-intercepted browser. Never
 * return generated HTML as an executing document in the user's browser. This
 * captures a bounded observation window, not proof of future code safety.
 */
export class ProductionPreview {
  private active?: { controller: AbortController; completion: Promise<Buffer> };
  constructor(private store: ProductionStore, private options: { timeoutMs?: number; observationMs?: number } = {}) {}
  get busy() { return Boolean(this.active); }
  async close() { this.active?.controller.abort(); await this.active?.completion.catch(() => undefined); }

  capture(runId: string, signal?: AbortSignal): Promise<Buffer> {
    if (this.active) return Promise.reject(new Error('已有运行中的截图，请稍后再试'));
    signal?.throwIfAborted();
    const html = this.store.readArtifact(runId, 'index.html');
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) return Promise.reject(new Error('截图源码超过 500 KB 上限'));
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const completion = Promise.resolve().then(() => this.render(html, controller)).finally(() => {
      signal?.removeEventListener('abort', abort);
      if (this.active?.controller === controller) this.active = undefined;
    });
    this.active = { controller, completion };
    if (signal?.aborted) controller.abort(signal.reason);
    return completion;
  }

  private async render(html: string, controller: AbortController): Promise<Buffer> {
    const signal = controller.signal;
    const timeoutMs = Math.min(10_000, Math.max(250, this.options.timeoutMs ?? 8_000));
    const observationMs = Math.min(1000, Math.max(100, this.options.observationMs ?? 400));
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let closePromise: Promise<void> | undefined;
    let stopping = false;
    const closeBrowser = () => (closePromise ??= browser?.close() ?? Promise.resolve());
    const faults: string[] = [];
    const fault = (message: string) => { if (faults.length < 8) faults.push(message); };
    let timedOut = false;
    let abortListener: (() => void) | undefined;
    let operation: Promise<Buffer> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abortListener = () => {
        stopping = true;
        reject(new DOMException(timedOut ? '截图超过时间限制，已停止浏览器' : '截图已取消', 'AbortError'));
        if (browser) void closeBrowser().catch(() => undefined);
      };
      signal.addEventListener('abort', abortListener, { once: true });
    });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      signal.throwIfAborted();
      operation = (async () => {
        const launched = await chromium.launch({ headless: true, timeout: Math.min(timeoutMs, 5000), args: ['--js-flags=--max-old-space-size=128'] });
        browser = launched;
        if (stopping || signal.aborted) { await closeBrowser(); throw new DOMException('截图已取消', 'AbortError'); }
        context = await launched.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: false, serviceWorkers: 'block' });
        let documentServed = false;
        // Context routing applies to every page, including a malicious popup.
        await context.route('**/*', async route => {
          const request = route.request();
          if (!documentServed && request.isNavigationRequest() && request.url() === DOCUMENT_URL) {
            documentServed = true;
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'content-security-policy': PREVIEW_CSP }, body: html });
          } else {
            fault('生成页面尝试网络访问或导航，已阻止');
            await route.abort('blockedbyclient');
          }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(Math.min(timeoutMs, 2000));
        page.setDefaultNavigationTimeout(Math.min(timeoutMs, 2000));
        context.on('page', popup => { fault('生成页面尝试弹窗，已阻止'); void popup.close().catch(() => undefined); });
        page.on('download', download => { fault('生成页面尝试下载，已阻止'); void download.cancel().catch(() => undefined); });
        page.on('dialog', dialog => { fault('生成页面触发对话框，已关闭'); void dialog.dismiss().catch(() => undefined); });
        page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== DOCUMENT_URL) fault('生成页面发生未授权导航'); });
        await page.goto(DOCUMENT_URL, { waitUntil: 'load' });
        await page.waitForTimeout(observationMs);
        if (faults.length || page.url() !== DOCUMENT_URL) throw new Error(`截图拒绝：${faults.join('；') || '发生未授权导航'}`);
        const png = await page.screenshot({ type: 'png', fullPage: false, timeout: Math.min(timeoutMs, 3000) });
        if (faults.length || page.url() !== DOCUMENT_URL) throw new Error(`截图拒绝：${faults.join('；') || '发生未授权导航'}`);
        if (png.byteLength > MAX_PNG_BYTES) throw new Error('截图超过 5 MB 上限');
        return png;
      })();
      return await Promise.race([operation, stopped]);
    } finally {
      stopping = true;
      clearTimeout(timer);
      if (abortListener) signal.removeEventListener('abort', abortListener);
      // Browser close terminates even a renderer stuck in generated JS. This is
      // a timeout/heap mitigation, not an OS-enforced CPU/total-memory sandbox.
      if (browser) await closeBrowser().catch(() => undefined);
      else await context?.close().catch(() => undefined);
      // Keep the admission slot until even a launch that lost the abort race
      // has settled and closed, so cancelled requests cannot stack browsers.
      await operation?.catch(() => undefined);
    }
  }
}
