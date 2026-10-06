import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getPopulationPack, getPopulationModel } from '../server/population/service';
import { getResidentTemplates, residentCreateSchema, residentPublic } from '../server/research/residents';
import { getResearchTemplates } from '../server/research/templates';
import { executeSurvey } from '../shared/survey-runner';
import type { SurveyRun } from '../shared/survey-engine';
import type { Run } from '../server/types';

// Author only from retained evidence. Missing live evidence is an error, not a fixture fallback.
const out = path.resolve('public/submission'); mkdirSync(out, { recursive: true });
const load = <T>(name: string) => JSON.parse(readFileSync(path.join(out, name), 'utf8')) as T;
const live = load<SurveyRun>('live-run.json');
const evaluation = load<any>('evaluation-summary.json');
const experiments = load<{ arm: string; run: SurveyRun }[]>('experiment-runs.json');
const delivery = existsSync(path.join(out, 'delivery-run.json')) ? load<Run>('delivery-run.json') : null;
const pack = getPopulationPack(); const model = getPopulationModel(); const task = getResearchTemplates()[2];
const preset = residentPublic(residentCreateSchema.parse(getResidentTemplates()[0]), '00000000-0000-4000-8000-000000000001', new Date().toISOString(), false);
const fixture = await executeSurvey({ task, population: model, pack, presets: [preset], count: 12, seed: 42, mode: 'fixture', signal: new AbortController().signal,
  pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, source: '规则工程夹具，不调用模型', suppliedAt: new Date().toISOString() }, call: async () => { throw new Error('fixture never calls'); } });
const json = (name: string, value: unknown) => writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
const recent = JSON.parse(readFileSync('data/population/evidence/binjiang-recent.json', 'utf8'));
for (const source of [...pack.sources, ...recent.sources]) {
  const bytes = readFileSync(source.localPath);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256 || bytes.length !== source.bytes) throw new Error(`来源校验失败: ${source.id}`);
}
json('sources.json', { preparedAt: new Date().toISOString(), historical: pack.sources, recent: recent.sources, observations: pack.observations, recentObservations: recent.observations, notes: ['七普两个索引指向同一PDF，不是两份独立测量。', '2025区级总量不更新2020街道结构。', '哈希只校验字节版本，不证明真实性。'] });
json('population-pack.json', pack); json('sample-questionnaire.json', live.task); json('sample-run.json', fixture); json('sample-profiles.json', fixture.profiles);
json('metrics.json', { scope: '当前49次居民实验，不含早期尝试和研发角色', preparedAt: evaluation.preparedAt, baseline: { id: live.id, durationMs: live.durationMs, ...live.metrics }, suite: { calls: evaluation.realModelRequests, inputTokens: evaluation.inputTokens, outputTokens: evaluation.outputTokens, conservativeCostCny: evaluation.conservativeApiCostCny }, priorAttempts: evaluation.priorAttempts, developmentRoles: delivery ? { id: delivery.id, status: delivery.status, ...delivery.usage, durationMs: Date.parse(delivery.finishedAt!) - Date.parse(delivery.createdAt) } : null });
writeFileSync(path.join(out, 'prompts.txt'), `本文件为真实基准运行的冻结Prompt，不含Key。\nSYSTEM\n${live.prompt.system}\n\n${live.prompt.users.map(item => `${item.residentId}\n${item.text}`).join('\n\n')}`);
const pdfs = [...new Set([...pack.sources, ...recent.sources].map(source => source.localPath as string).filter(name => name.endsWith('.pdf')))];
mkdirSync(path.join(out, 'sources'), { recursive: true }); for (const file of pdfs) copyFileSync(file, path.join(out, 'sources', path.basename(file)));
const esc = (value: unknown) => String(value ?? '未知').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const table = (headers: string[], rows: unknown[][]) => `<table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const section = (title: string, body: string) => `<section class="sheet"><h2>${title}</h2>${body}</section>`;
const demo = 'https://litianyi-007.github.io/city-agent/';
const choices = live.summaries.find(question => question.questionId === 'version-choice')!;
const features = live.summaries.find(question => question.questionId === 'top-features')!;
const payment = live.summaries.find(question => question.questionId === 'max-monthly-payment')!;
const arm = (name: string) => experiments.find(item => item.arm === name)!.run;
const choiceList = (run: SurveyRun) => run.responses.map(response => ({ id: response.residentId, value: response.status === 'valid' ? response.answers.find(answer => answer.questionId === 'version-choice')?.value : null }));
const first = choiceList(arm('controlled-price-19')); const second = choiceList(arm('controlled-price-29'));
const validSuite = experiments.reduce((sum, item) => sum + item.run.metrics.valid, 0);
const typeNames = { single: '单选', multiple: '多选', scale: '量表', number: '数值', text: '开放题' };
const body = `<section class="sheet"><div class="eyebrow">项目申报 / 阶段实证 / 2026-10-07</div><h1>City Agent<br>可追溯的虚拟社会调查</h1>
<p class="lead">已实现官方人口证据、合成画像、冻结问卷、独立作答与确定性统计；四角色自主交付已接入，最终验收仍未通过。</p>
<div class="experience"><strong>直接体验，无需登录</strong><br><a href="${demo}">${demo}</a><br>调查页点击「查看已发布实测 · 无需Key」即可检查真实模型快照。<br><a href="demo.mp4">约4分钟实际操作录屏</a> / <a href="live-run.json">12人完整问卷证据</a> / <a href="evaluation-summary.json">实验诊断</a></div>
<p class="status">当前已真实运行一组12人15题问卷及重复、价格对照、画像消融；小样本内部诊断有失败，完整保留。没有真人或业务留出校准，不宣称人口偏好、销量或选址已被验证。</p>
${table(['验收维度','本次可以证明的范围'], [['工程交付','问卷契约、五题型、居民隔离、分析、证据持久化与导出；四角色六次实测均未通过最终Gate'], ['仿真完成','当前基准12/12有效、180题回答；三街道各4个覆盖画像，无总体权重'], ['内部诊断','人口结构、自洽/五次重复、变量对照均实际运行；报告无效答卷及不稳定结论'], ['现实效度','未验证。照护者不是儿童；合成猫狗各2人不是市场份额；没有真实店址排序']])}
<h3>两种体验的边界</h3><p>公开GitHub Pages：问卷与人群配置、规则演示、实测快照、浏览器直连自备模型。Key只放当前会话内存，刷新清除；CORS不支持时明确失败。它不托管Node或Harness后端。</p><p>本机：Key经AES-256-GCM加密；DeepSeek Harness 0.1.5-rc.3执行居民问卷与四角色研发，独立Chromium验收。后端仅回环访问。生产服务、任意仓库开发、地图选址和长期社会运行时不在本版范围。</p></section>`
+ section('01 数据来源与可复用人口方法', `${table(['资料与发布者','时点 / 定位','用途与限制'], [['滨江区统计局2020版年鉴','2020-11-01七普；表1-2：印刷109/PDF117页；表1-5：印刷112/PDF120页','503,859常住人口：西兴143,318、长河168,276、浦沿192,265'], ['2023统计年鉴','2023年末；PDF10页','常住54.3万人；户籍街道表不替换常住结构'], ['2024统计公报','2024年末；PDF3页','常住55.2万人；男女数为户籍口径'], ['2025统计公报','2025年末；PDF3页','55.9万人，1%人口抽样推算；0.1万人发布精度']])}
<p>来源清单保留官方URL、发布者、统计期、原件、字节数、SHA-256和页表行列。28条观测保留输入/算术派生关系。同一PDF的两个索引不算两份独立证据。<a href="sources.json">来源与观测附件</a> / <a href="population-pack.json">RegionPack原始数据包</a>。</p>
<h3>新区域录入的六步方法</h3><ol><li>冻结区域边界、时点、常住/户籍口径及person/household等单位。</li><li>寻找政府原表；保留原始文件及定位。未公开必须记缺失，不填0。</li><li>转录子区域总量、年龄、性别等可用边际，校验总数及各口径冲突。</li><li>有完整联合表则保留观测；没有则显式选择联合推断，不伪造微观居民。</li><li>通过schema、算术、引用及原件哈希预检；RegionPack编译拒绝缺资料或覆盖输出。</li><li>发布独立版本，冻结到实验；新年份区级总量不自动替换旧街道分布。</li></ol>
<h3>本版的联合结构</h3><p>街道内逻辑人口＝该街道年龄人口×该街道全龄性别人口÷街道总人口。全龄24个逻辑单元，15+为12单元；联合为infer而非fact。15+共434,827人，但包含15-17岁。没有经验证的18+、照护或养宠分母。结构审计通过只能说明输入约束一致，不能证明独立性或消费行为真实。</p><p>没有社区、楼栋、住户微观记录或地图边界。2020结构不是2026实时人口；不能以三街道总人数代替候选铺位的客流和履约能力。</p>`)
+ section('02 人群、人格与角色构建（重点）', `<h3>三个分离层</h3>${table(['层次','构建方法','证据标记'], [['人口约束','地区/时期/街道/年龄档/原表性别来自冻结人口包','原表fact；联合关系infer'], ['研究资格与具体画像','预设AND筛选＋问卷筛选，交集为空拒绝；具体年龄在可行档内新抽取','18+切分、照护、养宠、职业/家庭描述为assumption'], ['行为与人格','用户可填描述和行为说明；进入每人Prompt并冻结；默认不赋商品偏好','情景假设，不是观察事实或校准人格']])}
<p>提供一般成年居民、小学生照护者、养猫和养犬购买者及自定义预设。可独立配置Provider、Base URL、Model ID、Key，支持复制、启停和编辑。人群预设与产品/研发/测试/研究员角色分开；复制配置不增加真实人口。年龄、性别、街道不直接决定收入、职业、人格或偏好。</p>
<h3>当前样本如何形成</h3><p>seed=42，优先覆盖未抽取的可行逻辑单元，再平衡街道；每次重新赋具体年龄。基准12个不同画像：三街道各4、两个可用年龄档各6、原表男女各6；没有概率权重。60+的生成上限90岁是工程假设。30人工程测试不再循环十二个固定画像；仍记录重复画像数，重复不算新增独立现实个体。</p>
<h3>独立作答与记忆边界</h3><p>每次只输入本画像、商品情景和完整冻结问卷，不包含其他居民答卷。模型返回稳定居民ID/题目ID的JSON，不获得主机工具权限。五次重复是五个新会话：未复用答案缓存；供应商输入前缀缓存可能存在，但仍重新生成答案。系统仅检查已登记年龄/街道硬约束，不用刻板偏好判断矛盾。</p><p>尚未实现连续追问、Big Five校准、家庭关系恢复、长期居民接管、wiki记忆、dream或外部现实MCP。这些是后续阶段，不作为当前人口真实性的证据。</p>
<h3>研发团队的职责</h3><p>产品冻结有界目标与四角色任务；研究员解释证据与风险；测试先冻结断言；研发生成单文件HTML。独立Chromium运行交互验收，失败最多返修2次。不把模型自述“测试通过”算验收。居民问卷账本和四角色账本分别保存。</p>`)
+ section('03 一份完整仿真问卷（重点）', `<p>AI生活服务会员概念：免费版基础AI+5GB，标准版19元/月+100GB，家庭版39元/月+最多5人共享500GB。商品均为待测设定，不是既有市场事实。</p>
${table(['题号 / 稳定ID','题型','题干'], live.task.questionnaire.questions.map((question, index) => [ `${index + 1} / ${question.id}`, typeNames[question.type], question.prompt ]))}
<p>五题型全部真实执行。完整选项、范围、单位、最大选项数与硬约束在<a href="sample-questionnaire.json">问卷JSON</a>。未知选项、重复项、居民ID错配、必答缺失及数值越界记无效；不填补成功。年龄与街道自洽另行诊断。未登记的职业/家庭跨题及开放题语义不宣称已验证。</p>`)
+ section('04 真实模型结果与逐数字追溯', `<p>基准运行 ${esc(live.id)}；${esc(live.startedAt)}（UTC）。provider=deepseek；https://api.deepseek.com；model=${esc(live.models[0].modelId)}。12次独立请求，12/12完整有效，年龄/街道矛盾0。总耗时${(live.durationMs / 1000).toFixed(2)}秒，输入${live.metrics.inputTokens}、输出${live.metrics.outputTokens} Token；保守API估算${live.metrics.apiCostCny?.toFixed(6)}元。</p>
${table(['套餐选项','合成选择人数','该题有效分母'], choices.choices!.map(choice => [choice.label, choice.count, choices.denominator]))}
${table(['功能选项','合成被选人数','该题有效分母'], features.choices!.map(choice => [choice.label, choice.count, features.denominator]))}
<p>模拟最高月支付均值${payment.mean?.toFixed(2)}、中位数${payment.median?.toFixed(2)} ${esc(payment.unit)}。只描述本次合成意向，不用于定价。多选比例可超过100%；街道每组只有4个画像，组间差异不是人口因果或总体估计。</p>
<h3>追溯路径</h3><p>结果 → 程序确定性汇总 → 原始JSON和有效状态 → resident ID → 冻结画像与资格假设 → 本人Prompt → 问卷/人口版本与来源。<a href="live-run.json">live-run.json</a>保留全部链路、模型公开配置、定价快照、执行参数、采样报告及原始答卷。<a href="prompts.txt">冻结Prompt全文</a>；使用sha256-canonical-json-v1，浏览器和后端共用同一算法。</p><p>运行前及逐响应保存快照；刷新/导航可从历史恢复；草稿编辑不覆盖旧结果。导入v2证据重新核对指纹、答卷和统计，但哈希不是数字签名或供应商身份认证。工程规则夹具另留<a href="sample-run.json">sample-run.json</a>，不混入模型发现。</p>`)
+ section('05 三类诊断与负结果', `${table(['类别','真实运行及结果','解释边界'], [['人口结构','16项结构/口径/算术审计通过，来源原件哈希再次核对','拟合约束，不是联合分布或真人偏好的外部效度'], ['个体自洽/重复','固定前三个画像，五次新会话，核心套餐选择最大一致数：'+evaluation.stability.map((item: any) => `${item.residentId} ${item.largestAgreement}/5`).join('；'),'4/5为诊断目标；无效答卷记null并保留，不删除负结果'], ['群体/变量','同3画像的19/29元独立对照；无画像、仅人口属性消融；程序输出街道/年龄/预设分组','小样本探索，不做总体显著性或现实因果声明']])}
<h3>价格单变量对照</h3><p>仅改标准版价格描述及同一选项标签，两组均删除问卷内价格/权益追问，其他条件冻结。选项ID含义由各臂题干定义。</p>${table(['画像','19元臂核心选择','29元臂核心选择'], first.map((item, index) => [item.id, item.value, second[index].value]))}
<p>option-1为免费版，option-2为标准版，option-5为不确定。标准版选择从1/3变为2/3，方向反直觉；这是小样本随机波动/情景敏感性的警报，不是提价能增销的证据，不补写单调价格公式。</p>
<h3>当前批次的失败不能藏起来</h3><p>本批49次请求，${validSuite}/49有效；五次重复中4份格式无效，无画像消融中1份无效，全部原文留档。家庭题出现不存在的option-6，不能算有效答卷。1/3画像达到4/5稳定目标；另外两人未达到。去掉画像后的答卷出现年龄/街道不一致，这是对照诊断，不证明完整画像更真实。</p>
${table(['其他流程测试','结果','不足'], [['小学生照护者零食问卷','3/3有效，关注配料/过敏原、份量、孩子接受程度','模拟购买许可，不能代替儿童口味或学校/候选点数据'], ['猫狗零食问卷','4/4有效，猫/狗各2个是预设采样结果','无养宠总体分母、规格化SKU价格、订单/客流，不能判主粮经营或网点地址'], ['未见社区工具租借配置','3/3有效，只改变配置，未新增场景分支','三人均不确定，泛化执行成功不等于需求明确']])}
<p><a href="experiment-runs.json">全部当前原始实验</a> / <a href="evaluation-summary.json">诊断汇总</a> / <a href="prior-attempts.json">更早尝试与勘误</a>。更早51次尝试包含一次截断；原SDK输入未包含缓存读写量，旧总Token/费用未知，保留原始记录。当前批次已修正总输入计数，不将重跑包装为删除失败后的成功率。</p>`)
+ section('06 技术参数、交付与业务价值', `${table(['关键项','本次固定记录'], [['运行时 / 参数','DeepSeek Harness 0.1.5-rc.3；3000输出Token，90秒超时，并发1，居民不重试；DeepSeek thinking disabled；不设置temperature/供应商seed'], ['居民实验账本',`${evaluation.realModelRequests}次请求；总输入${evaluation.inputTokens}、输出${evaluation.outputTokens} Token；保守API估算${evaluation.conservativeApiCostCny.toFixed(6)}元`], ['计费与计时依据','CNY/百万Token：输入2、输出8，官方Flash高峰且全部缓存未命中上界估算；包含缓存输入。最终以账单为准。计时从画像构建前到统计完成，含等待，不含渲染/持久化/导出'], ['四角色交付', delivery ? `${delivery.id}；状态${delivery.status}；${delivery.agentSnapshot.map(agent => agent.role + ':' + agent.modelId).join('；')}；输入${delivery.usage.inputTokens}/输出${delivery.usage.outputTokens}；费用未知（异模型未计价）` : '未附实测证据，不认定完成'], ['安全与范围','禁用Harness主机工具；生成代码只在受限浏览器执行；最多12次研发调用/2次返修/15分钟；只交付离线单页']])}
<p>两种model selector不等于独立核验底层模型；API名以<a href="https://api-docs.deepseek.com/quick_start/pricing/">当前官方目录</a>为准。<a href="https://api-docs.deepseek.com/guides/thinking_mode/">思考模式</a>需显式关闭以避免问卷输出预算被思考消耗。<a href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/">人民币价格依据</a>存入证据快照。角色失败、取消和旧记账未知成本不混入49次当前费用。</p>
<p>${delivery ? `四角色${delivery.status === 'completed' && delivery.gate?.passed ? '已自动交付并通过' : '尚未通过'}冻结浏览器验收，Gate只证明本页检查。<a href="delivery-run.json">角色输出与事件</a> / <a href="delivery-manifest.json">manifest</a> / <a href="delivery-acceptance.json">冻结断言</a> / <a href="delivery-gate.json">Gate</a> / <a href="delivery-source.txt">交付源码（文本）</a> / <a href="delivery-attempts.json">全部交付尝试</a>。此前有错误模型名、来源标记、代码截断、分组交互和选择器冲突失败，不删旧结果；不同工程版本的尝试不能合成统一模型成功率。` : ''}不称“通用L5已证明”，不把离线交付等同公网Harness服务。</p>
<h3>创新点与近期业务价值</h3><p>①保留人口事实到逻辑单元的证据链；②人口、业务资格与人格假设分离；③开发角色与受访居民分离；④统一契约运行五题型、自定义配置与对照实验；⑤失败、成本和模型结果连同确定性统计交付。价值是加快问卷设计、识别资格缺口、预演概念及准备可证伪真人访谈假设。不填虚构节约比例、销量提升或选址ROI。</p>
<h3>下一步停止线</h3><p>先提高无效选项与重复稳定性，并扩约30人独立批次；补未见配置到异构页面的全链路和多次交付。真实选址需学校/宠物家庭/候选点、规格价格、线上订单、客流、租金与履约证据；真人或业务留出仅作为后续效度检验。自然语言自动拆问卷、追问、家庭模型、记忆/dream和MCP现实输入仍未实现。</p>
<p>原件：${pdfs.map(file => `<a href="sources/${path.basename(file)}">${esc(path.basename(file))}</a>`).join(' / ')}。<a href="https://www.jasss.org/20/4/16.html">人口合成研究参考</a>、<a href="https://arxiv.org/abs/2304.03442">Generative Agents研究参考</a>仅为后续方向，不声称已采用其完整算法。</p>`);
const css = `body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#203747;background:#eef3f6;margin:0}main{max-width:920px;margin:30px auto;background:white;padding:38px}h1{font-size:40px;line-height:1.35;color:#102d3c}h2{font-size:23px;color:#102d3c;margin:0 0 15px}h3{font-size:17px;margin:21px 0 8px}p{margin:11px 0}.sheet{padding:18px 0 32px}.eyebrow{font-size:12px;letter-spacing:2px;color:#27796e}.lead{font-size:20px}.experience{background:#edf8f4;border:1px solid #a8d1c4;padding:18px;line-height:1.8}.status{background:#fff7e6;padding:14px;border-left:4px solid #b78735}a{color:#126b61;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;margin:12px 0}th,td{padding:8px;border:1px solid #cbd9df;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf2f4;text-align:left}th:first-child{width:24%}.toolbar{max-width:990px;margin:20px auto;text-align:right}ol{padding-left:24px}@media(max-width:700px){main{padding:20px;margin:0}h1{font-size:29px}table{font-size:12px}}@media print{@page{size:A4;margin:16mm}body{background:white;font-size:10pt;line-height:1.5}main{margin:0;padding:0;max-width:none}.sheet{padding:0;break-before:page}.sheet:first-child{break-before:auto}h1{font-size:26pt;margin:18px 0}h2{font-size:16pt}h3{font-size:11pt;break-after:avoid}table{font-size:8.8pt}th,td{padding:6px}tr{break-inside:avoid}thead{display:table-header-group}p{orphans:3;widows:3}.lead{font-size:13pt}.toolbar{display:none}}`;
writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City Agent 阶段实证申报材料</title><style>${css}</style></head><body><div class="toolbar"><a href="project-materials.pdf">下载PDF</a> / <a href="project-materials.md">文字材料</a></div><main>${body}</main></body></html>`);
const markdown = body.replace(/<table>.*?<\/table>/gs, markup => { const rows = [...markup.matchAll(/<tr>(.*?)<\/tr>/gs)].map(row => [...row[1].matchAll(/<(?:td|th)>(.*?)<\/(?:td|th)>/gs)].map(cell => cell[1].replace(/\|/g, '\\|'))); return `\n\n| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n')}\n\n`; }).replace(/<h([1-3])>(.*?)<\/h\1>/g, (_, level, text) => `\n${'#'.repeat(Number(level))} ${text}\n\n`).replace(/<a href="([^"]+)">(.*?)<\/a>/g, '[$2]($1)').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|li|section)>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
writeFileSync(path.join(out, 'project-materials.md'), markdown);
writeFileSync(path.join(out, 'video-script.md'), '# 实际页面录屏（约4分钟）\n\n0-25秒：体验入口与实测/真人边界。25-60秒：人口来源与方法。60-105秒：人群预设与页面模型配置（无Key出镜）。105-145秒：编辑15题与预检。145-175秒：规则工程运行，明确不调用模型。175-220秒：载入公开真实基准，查看分组、对照与原始答卷，导出证据。220-240秒：展示申报资料与负结果，说明公网不运行Harness，未验证真实市场。\n');
console.log(JSON.stringify({ liveId: live.id, calls: evaluation.realModelRequests, validSuite, delivery: delivery?.status ?? 'not-attached', out }));
