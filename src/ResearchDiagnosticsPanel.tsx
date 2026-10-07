import { memo, useMemo } from 'react';
import { diagnoseBusinessResearchRun } from '../shared/research-diagnostics';
import { validateQuestionnaireLogicRules } from '../shared/questionnaire-logic';
import type { SurveyRun } from '../shared/survey-engine';
import { downloadJson } from './research-client';

/** Read-only projection. Neither the old run nor its frozen audit is changed/saved. */
export const ResearchDiagnosticsPanel = memo(function ResearchDiagnosticsPanel({ run, logicAudit }: { run: SurveyRun; logicAudit: unknown }) {
  const result = useMemo(() => {
    try {
      const scenarioId = run.task.id === 'business-child-snacks' ? 'child-snacks' : run.task.id === 'business-pet-snacks' ? 'pet-snacks' : null;
      if (!scenarioId || !logicAudit || typeof logicAudit !== 'object' || !('rules' in logicAudit)) throw new Error('需要匹配场景和当时冻结的规则；不会套用当前示例规则。');
      const logicRules = validateQuestionnaireLogicRules(run.task, logicAudit.rules);
      return { report: diagnoseBusinessResearchRun(run, { scenarioId, logicRules }), error: null };
    } catch (error) { return { report: null, error: (error as Error).message }; }
  }, [run, logicAudit]);
  if (!result.report) return <p className="research-note warning">新版本诊断不可评估：{result.error}</p>;
  const { report } = result;
  return <section aria-label="研究内容与执行状态诊断">
    <h3>研究内容与执行状态 · 独立只读诊断</h3>
    <p className="research-note">计划 {report.planned} 个合成个人；已检查 {report.summary.checked}、未启动 {report.summary.notStarted}、结构阻断 {report.summary.structureBlocked}、未知 {report.summary.unknown}。已检查不等于通过，未启动不算身份冲突。</p>
    <p className="research-note">内容：{report.summary.content.scenarioInformationPresent} 份含情景信息，{report.summary.content.informationInsufficient} 份信息不足，{report.summary.content.notEvaluated} 份未评估。合法未知不会被强行补成偏好。</p>
    <p className="research-note warning">这些分母不是独立家庭、儿童人数或真实合格消费者。情景信息不认证消费历史、市场比例、铺位推荐或主营品类；儿童原文和宠物主粮结论需要另行采集。</p>
    <details><summary>逐人状态、知识来源与信息缺口</summary><pre className="evidence-audit-json">{JSON.stringify(report, null, 2)}</pre></details>
    <button type="button" className="secondary" onClick={() => downloadJson(report, `research-diagnostics-${run.id}.json`)}>导出独立研究诊断 · 不修改原证据</button>
  </section>;
});
