# 质量与评委发布 v6：本批审查与验证记录

## 运行口径

本批从44db85e2c1230a01175beb00137243a31391fb12开始；开发、测试及提交仅在独立 production worktree。冻结申报基线 b66122c21604fdb2ecdcbafb89c3d5ad8cde1466 保持不变。实现目标见 QUALITY-V6-DESIGN.md；当前记录随工程验证更新，不把进行中的工作标为已通过。

## 对抗审核

外层实现 Agent 与独立交叉审查分开；code quality／security／server专项覆盖本批差异，并以冻结基线核对生产线兼容边界。docs/lessons不存在，无可适用历史教训。原申报MD、实验原件、视频不修改。

已发现并修复、独立复审关闭的 P2：

1. 材料标签缺失／旧版可跳过 REAL-02 验证：publisher精确要求当前版本，并绑定内嵌 package-manifest 和精确清单；负例拒绝多余HTML／缺预览／变化源码。
2. ZIP从校验后原磁盘重新读造成 TOCTOU：导出使用已核验内存快照；视频探测同样用已核验字节。
3. ZIP inflate 接受声明长度内隐藏第二压缩流：只接受当前生成器的规范压缩成员并验证全部压缩字节、解压字节和 CRC；负例覆盖第二流／padding。
4. clone失败后可能进入既有旧目录继续安装：复制脚本单独subshell、set -e、已有目录拒绝，失败不执行后续。
5. 公开预览／首屏只验证路径和外层hash，仍可能替换为任意脚本：publisher从已核验源字节用当前固定生成器重建三个可信预览及两个portal，五个可执行HTML必须逐字一致。
6. 旧Jev费用标签写“全包”但不含新增REAL-02：旧账本与本次52HTTP的study分列，避免漏报或与单次生产usage双加；供应商账单仍unknown。
7. 手写指南使用 set -e 下的 test && test 不能保证前项失败即停：同步为显式 if 普通目录或symlink存在则exit，和生成安装块保持一致。
8. 手写指南注释掉固定commit仍能执行浮动HEAD安装：改为克隆前要求输入并检查完整40位SHA，缺失／错误直接退出，实际checkout不可跳过。
9. 归档运行分母被写成全部历史生产：聚合标为“本包归档真实生成／调优”，相机专属9次单列；额外 HTML-01／02 原结果提供固定commit链接，不把跨配置结果拼成成功率，不修改原统计。
10. 评委新安装的默认模型仍是退役ID：新建六角色、API与新Agent表单统一默认deepseek-flash；现有配置、Key、单价和旧运行不迁移。官方依据为[当前API入门](https://api-docs.deepseek.com/en/)与[更新日志](https://api-docs.deepseek.com/updates/)，核查日期2026-10-08。
11. 新source-v4固定公开字符串未进入Key保留列表：补齐schema与store写入拒绝及全部≥16字符子串反例；先前prepare也拒绝碰撞，但现在配置保存时即拒绝。旧v2/v3保护与已有加密配置不改写。

最后通用导出文案复审额外确认：含HTML运行的合法包不能无条件宣称其不计本包总体。已改为独立原档固定链接、与相机分母分开，总体依据mixed-and-live-runs.json／real-camera-runs.json实际run IDs。2026-10-08 05:05:31（北京时间）源码与测试冻结；交叉审查无开放P1/P2，Jev实现未由作者自审。

## 验证状态

全量首轮764/771，972.949秒，7项失败均为当前Jev回放结果版本已v4而两旧测试硬编码v3；不是行为Gate被放宽。只更新当前结果标记和counterfactual标题，历史v2/v3原件版本／hash／状态／数值门限保留，Jev子集98/98（24.271秒）和独立两文件10/10通过。用于抓取失败详情的第二轮在定位7项后主动停止，仅终止本worktree自建测试进程并保留TAP；不排除或追认该中断轮。

第三轮769/771，747.534秒；执行期间安排了上述新安装配置修补，两个原生loopback实验正确发现冻结源码漂移并停止，实际供应商请求为0。不降低源码身份校验，也不将该轮追认为通过。保留full.tap与full-v4-final.tap；以下最终轮次使用已冻结源码独立重跑。

浏览器全量47/47（约1.5分钟），包括原人口／学校／宠物／问卷功能；新增表单专项9/9（15.0秒）。首次新表单2失败因服务使用旧dist，重建后通过；材料专项初轮54/55是旧npm ci文本断言，随engine-strict安全安装更新后重跑。最终材料/发布专项61/61（2.921秒），其他独立专项66/66、94/94、29/29及广域186/186分列，存在重叠不合计为独立样本。TypeScript、build和diff-check通过；最终发布前干净build另核验。

冻结前晚补丁：默认模型／保存配置／v4字串保护专项48/48（26.945秒），新Agent与克隆浏览器1/1（3.5秒），独立交叉专项21/21；最后展示口径与发布专项56/56（6.142秒）。均为免费工程证据，不改变历史Gate或模型结果。

秘密扫描只覆盖Git tracked及非ignored文件（648），不读取用户私有状态；唯一模式匹配为未改动的合成诊断测试secret，不是新增真实Key。REAL-02内层573 JSON解压只读秘密扫描、原账本SHA核验通过；四份修改前文档逐字留底核对4/4。历史实验路径／已提交SUBMISSION-REPORT／主线代码无修改。

新真实模型调用为0；REAL-02原始52 HTTP属于上一批，公开材料仅继承它的实际结果。无新模型费用；外层开发Token和供应商账单unknown。

## 发布边界

回归与审查已完成，干净publisher commit将导出新v6衍生PDF、继承旧视频，普通推送feature/autonomous-production，并只追加gh-pages:production/reviews/<commit>/及更新两个入口指针。发布回执保留production外root SHA与既有内部叶子不变的结果。实际部署URL和SHA在独立发布回执中记录，不能先写成完成。

## 最终冻结验收

冻结源码 afebed18501eeb2afb2bd5d3966ae562276f2e95 已提交普通推送；最终单元／集成全量773/773，922.520秒，0失败／取消／跳过。浏览器重新全量47/47，约1.5分钟；tsc、Vite构建、源码／构建／启动身份匹配且ready=true。最终PDF发布工具版本只追加本节等文档验收记录，源代码与上述冻结commit保持相同；原实验与旧申报不修改。

免费复现（Node22、新目录独立安装后）为`npm test`与`npx playwright test --config docs/production/baseline.playwright.config.ts`。本地原TAP在ignored output/production-quality-final-dYjZML/full-frozen-afebed1.tap，SHA-256为575955c639c88aa88280ae02ae193608811286b8fd499b7e448bf1c7889e06b1，未冒充公开供应商日志。统计不合计重叠专项、不排除前三轮失败／中断，也不把本次工程通过计为真实自主交付。

独立GitHub全新克隆安装验证：608独立依赖、官方Chromium独立缓存，未复制数据库或Key；固定afebed1完整SHA，端口4520／5520／4522／4521，clean、build、HEAD及服务身份一致。六个Agent均deepseek-flash且无Key／费率；首次Mock-01实际Chromium Gate3/3，1397毫秒、0返修。随后浏览器实操Mock-02，Gate3/3、1206毫秒、0返修。两者仅夹具、0模型请求。新需求编辑器可输入费用记录题，缺来源／验收／Key／预算时启动被明确阻止，不套用旧Mock通过；截图保留本地验收目录。

真实HTML新配置、Jev v4与source-bound-v1的效果仍需新的明确预算和预登记；本批新收费模型请求为0，不沿用已消费REAL-02授权。外层开发Token、机器费用和供应商最终账单unknown。
