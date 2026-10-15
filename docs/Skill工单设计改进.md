# Human Use 工单设计 Skill 改进记录

日期：2026-10-15。方法：本机 workflow-improvement 与 skill-creator。代码基线：`fc475f89d9581ce8c33ae6b6d333b3a6cd44ce18`，包版本 0.3.0。

## 问题、范围与验收

用户希望 Agent 了解完整控件能力，优先选与任务匹配的控件，并以人能轻松理解的语言说明行动、结果和证据要求。原 Skill 只有类型枚举和接口流程，缺少选型、工单写法、反例和完整范例。

本轮只修改仓库内的 Skill 指令、配套参考及本记录，不改 UI、API、数据库或 AGENTS，不操作真实工单，不更新安装服务。验收是六种现有类型均有清楚的用途与边界，范例通过实际 Store 契约检查，且完成独立上下文审核。收益未做人类可用性测试，不宣称填写速度或认知负担已有量化改善。

## 已读取依据

外部正文读取日期均为 2026-10-15；仅保存链接、版本及本地转述，不归档第三方全文，因此没有原件归档文件或原件 SHA-256。

| ID | 来源与定位 | 版本、读取状态与适用限制 |
| --- | --- | --- |
| S0 | 本仓库 store.mjs 的 validateUnits / validateAnswers、public/app.js 的控件、history 与 Get Time、docs/API.md | 上述 Git 基线，已读实现。是类型、必填、数组答案、时间和退回规则的权威依据；不是外部设计研究。 |
| S1 | [GOV.UK Question pages](https://design-system.service.gov.uk/patterns/question-pages/)：When to use、How it works、Hint text、Asking multiple questions on a page | 已读网页和 [GitHub 原文](https://github.com/alphagov/govuk-design-system/blob/d10a01d9b95e39558bb9d88fef97197b0f24c71a/src/patterns/question-pages/index.md)。提交经 gh 核实；不假设网站部署一定对应该提交。采用必要性、减少重复与允许有效的不确定回答，不照搬一页一问或 GOV.UK 特定布局。 |
| S2 | [GOV.UK Radios](https://design-system.service.gov.uk/components/radios/)：When to use / not to use、How it works | 无版本号网页，已读正文。单选语义及适当的“无法判断”选项；不引入条件显隐、排序制度或新组件。 |
| S3 | [GOV.UK Checkboxes](https://design-system.service.gov.uk/components/checkboxes/)：When to use / not to use、How it works | 无版本号网页，已读正文。多选与单选区分；普通复选框不等同于本软件的全部必填 checklist，需结合 S0。 |
| S4 | [W3C WAI Form Instructions](https://www.w3.org/WAI/tutorials/forms/instructions/)：Overview、Overall instructions、In-line instructions | 无版本号教程，已读正文。采用明确标签、格式和填写提示；不代表本软件已经通过 WCAG 或辅助技术验证。 |
| S5 | [Microsoft Writing step-by-step instructions](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/writing-step-by-step-instructions)：Scannability、Multiple-step procedures、Tips for writing steps | 页面标示更新 2026-04-02，已读正文。迁移动词、操作位置、顺序和减少无关说明，不强制英语语法或固定步数。 |
| L1 | 本会话中对附件无文字对勾、删除提示歧义、退回补充控件和操作时间的真实反馈 | 用户已指出具体理解困难；属于本项目证据，不可外推为所有用户的统计结论。 |

## 文件级缺口与实施计划

| 文件 | 缺口 / 拟改内容 | 依据 | 预期行为与检查 |
| --- | --- | --- | --- |
| skills/human-use/SKILL.md | 完整六类控件表；要求按任务选控件、少收集、不诱导；明确工单目标、位置、动作、输出与验收 | S0–S5、L1 | Agent 从入口即可选择恰当控件；独立场景试写和静态校验。 |
| skills/human-use/references/authoring.md | 按字段撰写方法、反例、三个完整工单范例与追加补充项范例 | S0–S5 | 范例覆盖六种类型，并展示少量控件组合；JSON 由当前 Store 实际校验。 |
| skills/human-use/references/api.md | 指向撰写指南，不重复维护另一套设计原则 | S0、本机 skill-creator | Skill 内相对链接可达，接口示例职责保持明确。 |
| 本文件 | 来源映射、采用与裁剪、检查结果及审核处置 | 本机 workflow-improvement | 区分来源事实、本地选择、静态检查、模型试写和人类验证。 |

## 本地设计选择与边界

- 六种类型、必填含义、时间戳存储及追加规则来自 S0。外部指南不授权新增条件显隐、占位符、min/max 或自动填答等接口字段。
- “目标—上下文—动作—结果—完成条件”是本地撰写检查法，不是外部规范的固定模板；简单工单无需凑齐五段。可执行性优先，不规定统一字数、条目数或时长阈值。
- 优先结构化输入，不等于所有工单都放满六种控件。已知信息由 Agent 写好上下文，用户只补 Agent 确实缺少的行动或观察。
- 记录失败、异常或不确定结果与完成调查可以同时成立；不能用必填 checklist 迫使人宣称“正常”。确实无法执行的任务使用现有“无法完成”流程，不要求伪造必填答案。
- 新指南面向当前源码能力。本机安装服务仍为先前构建，不能仅覆盖用户级 Skill 后就声称新控件和追加接口可用；安装更新需另按部署流程完成。

## 检查与独立审核

- Skill 格式：quick_validate.py 通过；名称与发现描述保持原范围。
- 链接：Skill 主文、API 参考及新增撰写指南的相对链接全部可达。
- 范例：解析三个完整 JSON，合并覆盖六种现有类型；逐一通过当前 Store.create。用合成的“未显示按钮”答案实际提交成功，再将补充截图片段与该合成提交的真实版本和哈希组合，Store.review 通过，旧快照未改变。
- 打包：npm pack --dry-run 确认新增参考文件包含在现有 skills/ 白名单中，没有修改打包规则。
- 运行范围：上述契约检查只创建 .test-data 下的合成数据；未创建实际业务工单、访问真实项目、覆盖用户级 Skill 或重启已有服务。未修改运行代码，因此不重复执行整套应用回归。
- 独立审核：由不继承父聊天的 skill_authoring_review Agent 审核实际文件及必要源码，并重新读取外部原始正文。未发现需按 P0–P3 提出的实质性问题，无必需修订。它没有单独核实 GitHub 固定提交与先前会话反馈；这两项由作者核实，不冒称得到双重验证。
- 独立场景试写：A 仅用一个单选判断按钮可见性；B 仅用 number + timestamp 记录刷新后的错误数与时间；C 仅追加缺失的窗口标题截图，不要求重做操作。三个 JSON 已解析，使用 Store 原始校验函数在内存中通过请求或追加单元校验；没有实际业务接口调用。C 的 version=2 与 64 个 a 的哈希明确为试写输入，不可发送给真实工单。
- 审核处置：接受“无必需修订”的结论，并逐项复核控件种类、必填语义、数量零值、时间可编辑及追加规则均与 S0 一致；本轮没有待解决的审核意见。不将模型试写当作人类可用性试验。
- 本机审核产物：.test-data/skill-authoring-review/review.md、trials.json。它们属于已忽略的检查产物，不随 npm 包分发；本记录保留可公开复查的审核范围与结果。

## 交接与使用

Skill 指令和配套撰写指南是一组修改，来源与审核记录单独提交。本轮 Git 只包含上述四个负责文件；沿用前一轮的分批提交推送方式，不创建版本 tag、Release 或 npm 发布。

安装中的服务与用户级 Skill 未变更。后续更新时应安装包含当前服务与完整 skills/ 的同一构建，再执行 setup codex 刷新用户级包装器和参考文件；现有服务按部署指南先停止、更新后重启。本轮没有执行这些部署动作。

后续真实试用应观察：用户是否还需要追问目标和操作位置、是否存在被迫填写的无效答案、是否出现重复截图或重做，以及验收时缺失信息是否减少。样本和收益目前未知；如出现问题，按原始反馈修订这组指南，不先增加固定字段配额或新的控件。
