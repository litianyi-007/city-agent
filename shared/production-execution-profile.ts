/** Describes the existing HTML Gate; this is not a grant of new permissions. */
export const HTML_EXECUTION_PROFILE_VERSION = 'production-html-execution-v1' as const;

export const HTML_EXECUTION_PROFILE = Object.freeze({
  version: HTML_EXECUTION_PROFILE_VERSION,
  capability: 'offline-single-html' as const,
  cspDirectives: Object.freeze([
    "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
    'img-src data:', "connect-src 'none'", "worker-src 'none'", "frame-src 'none'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    'sandbox allow-scripts',
  ] as const),
  networkRequests: 'denied' as const,
  navigation: 'denied' as const,
  nativeFormSubmission: 'disabled-before-submit-event' as const,
  inlineScriptsAndStyles: 'allowed-without-eval-or-external-resources' as const,
  localInputHandling: Object.freeze(['explicit-button-click', 'local-key-handler'] as const),
  gateInteractions: Object.freeze(['fill', 'click'] as const),
  independentPagePerCheck: true,
});

export const HTML_EXECUTION_INSTRUCTIONS = `HTML执行事实 ${HTML_EXECUTION_PROFILE_VERSION}：这是现有受限Chromium Gate的能力说明，不增加权限。响应CSP固定为sandbox allow-scripts与form-action 'none'，没有allow-forms；原生form提交在submit事件触发前即被禁止，不能依赖form submit、type=submit或requestSubmit来驱动业务，即使submit监听器调用preventDefault也不可用。使用type=button的明确click处理器或本地键盘处理器更新DOM；按键处理不得触发原生form提交。Gate机械交互只有fill/click，不要生成它不支持的键盘测试步骤。允许内联JS/CSS与data图片，不允许eval、外部资源、网络、导航、弹窗、下载、iframe或worker；尝试外联/导航会导致Gate失败。每个检查使用独立新页面。此说明不是测试已通过声明，必须执行冻结的实际功能Gate。`;

export const HTML_DOM_CONTRACT_INSTRUCTIONS = 'HTML DOM契约：测试角色在研发前定义并冻结普通CSS选择器及精确预期；为业务内容使用独立内容节点，为操作控件使用独立按钮节点。assertTextExact应选择业务内容节点，而非包含完成/删除等按钮文字的整行容器；计数使用实际条目容器，不能用内容文本代替数量。涉及新增/删除/状态更新及统计的需求，每次操作后分别验证实际条目数、内容/状态及相关统计；状态更新不得意外新增或丢失条目，不只检查某段统计文字。研发必须逐一实现已冻结的选择器、节点层级、文本与真实行为，不能把类仅加在另一个节点或仅在错误状态添加；不能改选择器、测试或精确预期来迎合自己的产物。冻结后若发现契约缺陷，应明确失败并保留证据，不能静默改Gate。';
