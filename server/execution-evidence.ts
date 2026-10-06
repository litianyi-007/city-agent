import type { AgentPublic, RunMode, RunStatus } from './types.js';

export interface ExecutionEvidenceInput {
  mode: RunMode;
  status: RunStatus;
  /** Adapter invocation attempts, including failed calls and format retries. */
  modelCalls: number;
  /** Fulfilled adapter calls, counted before parsing/validating their output. */
  modelResponses: number;
  usesInjectedModel: boolean;
  usesInjectedGate: boolean;
  gatePassed: boolean;
  /** A GateResult was returned in this run, not merely a gate configured. */
  gateExecuted?: boolean;
  /** Acceptance checks were frozen before the implementation being checked. */
  acceptanceFrozen?: boolean;
  /** The final HTML was successfully persisted; partial failed runs may have it. */
  artifactDelivered?: boolean;
  agentSnapshot: readonly AgentPublic[];
}

type EndpointClass = 'loopback' | 'non-loopback' | 'unknown';

export interface ExecutionEvidence {
  schemaVersion: '1.0';
  engineering: {
    scope: 'single-file-offline-html';
    status: 'verified-engineering-with-frozen-checks' | 'unverified-delivery' | 'not-delivered';
    runStatus: RunStatus;
    artifact: {
      available: boolean;
      deliveryStatus: 'delivered' | 'partial' | 'not-produced';
      origin: 'demo-template' | 'live-pipeline';
    };
    gate: {
      kind: 'not-executed' | 'injected-test-double' | 'chromium-gate';
      passed: boolean | null;
      frozenChecks: boolean;
      /** Verification of this completed delivery, not historical gate success. */
      verifiesDelivery: boolean;
    };
  };
  modelExecution: {
    transport: 'not-used' | 'injected-adapter' | 'deepseek-harness';
    calls: number;
    responses: number;
    responseStatus: 'not-called' | 'no-responses' | 'partial-responses' | 'responses-received';
    identityStatus: 'unverified' | 'not-applicable';
    /** The current adapter does not report independently observed model identity. */
    observedModels: null;
    configuredModels: Array<{
      agentId: string;
      role: AgentPublic['role'];
      provider: AgentPublic['provider'];
      modelId: string;
      endpointClass: EndpointClass;
    }>;
  };
  marketResearchValidated: false;
  realL5Evidence: false;
  limitations: string[];
}

/** Classification only: neither a remote address nor a provider label is authentication. */
function classifyEndpoint(baseUrl: string): EndpointClass {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'unknown';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return 'loopback';
    return 'non-loopback';
  } catch {
    return 'unknown';
  }
}

/**
 * Summarize runtime observations without promoting configuration into proof.
 * Pure function: no network, file access, environment reads, or secret spreading.
 * It does not independently attest the caller's counters, files, or gate result.
 */
export function buildExecutionEvidence(input: ExecutionEvidenceInput): ExecutionEvidence {
  if (!Number.isSafeInteger(input.modelCalls) || input.modelCalls < 0
    || !Number.isSafeInteger(input.modelResponses) || input.modelResponses < 0
    || input.modelResponses > input.modelCalls) {
    throw new RangeError('Execution counters must be non-negative safe integers with responses <= calls.');
  }

  const gateExecuted = input.gateExecuted === true;
  const acceptanceFrozen = input.acceptanceFrozen === true;
  const artifactAvailable = input.artifactDelivered === true;
  const delivered = input.status === 'completed' && artifactAvailable;
  const verified = delivered && gateExecuted && input.gatePassed
    && !input.usesInjectedGate && acceptanceFrozen;
  const called = input.modelCalls > 0;
  const limitations = [
    '执行记录由本地运行器提供，不是独立审计或远端模型身份认证。',
    '调用次数记录适配器请求尝试；回复次数记录适配器成功返回，不保证回复结构有效，也不证明指定模型真实执行。',
    'provider、modelId 与 endpoint 类别均来自配置；当前 SDK 不提供已核验的观测型号，非本机地址也不构成厂商认证。',
    '工程验证仅覆盖单文件离线 HTML 的冻结检查，不证明需求完整性、生产安全、上线可用性或通用无人干预 L5 能力。',
    '人口统计与规则仿真不等于真人商品调研；本次运行未验证市场需求、购买意愿或预测效度。',
  ];
  if (input.mode === 'demo') limitations.push('Demo 产物来自版本化模板，不是模型生成代码的证据。');
  if (input.usesInjectedModel && called) limitations.push('模型执行使用注入适配器，可能是测试替身；不能据此宣称真实厂商模型调用。');
  if (input.usesInjectedGate && gateExecuted) limitations.push('Gate 使用注入测试替身；其通过结果不构成 Chromium 浏览器验证。');
  if (called && input.modelResponses === 0) limitations.push('记录到请求尝试，但没有收到适配器回复。');
  if (input.gatePassed && !verified) limitations.push('Gate 通过标志不能单独证明交付：还需本次真实 Gate 执行、冻结检查、产物落盘和最终 completed 状态。');
  if (input.mode === 'demo' && called) limitations.push('Demo 模式出现调用计数，与正常零调用模板流程不一致，需要核查；不会据此标记模型生成产物。');

  return {
    schemaVersion: '1.0',
    engineering: {
      scope: 'single-file-offline-html',
      status: verified ? 'verified-engineering-with-frozen-checks' : delivered ? 'unverified-delivery' : 'not-delivered',
      runStatus: input.status,
      artifact: {
        available: artifactAvailable,
        deliveryStatus: delivered ? 'delivered' : artifactAvailable ? 'partial' : 'not-produced',
        origin: input.mode === 'demo' ? 'demo-template' : 'live-pipeline',
      },
      gate: {
        kind: !gateExecuted ? 'not-executed' : input.usesInjectedGate ? 'injected-test-double' : 'chromium-gate',
        passed: gateExecuted ? input.gatePassed : null,
        frozenChecks: acceptanceFrozen,
        verifiesDelivery: verified,
      },
    },
    modelExecution: {
      transport: !called ? 'not-used' : input.usesInjectedModel ? 'injected-adapter' : 'deepseek-harness',
      calls: input.modelCalls,
      responses: input.modelResponses,
      responseStatus: !called ? 'not-called' : input.modelResponses === 0 ? 'no-responses'
        : input.modelResponses < input.modelCalls ? 'partial-responses' : 'responses-received',
      identityStatus: called ? 'unverified' : 'not-applicable',
      observedModels: null,
      configuredModels: input.agentSnapshot.map((agent) => ({
        agentId: agent.id, role: agent.role, provider: agent.provider, modelId: agent.modelId,
        endpointClass: classifyEndpoint(agent.baseUrl),
      })),
    },
    marketResearchValidated: false,
    realL5Evidence: false,
    limitations,
  };
}
