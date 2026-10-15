# Writing work orders people can follow

Use this guide to draft a request or ask for supplementary information. The complete control catalogue is in [SKILL.md](../SKILL.md); wire formats and lifecycle calls are in [api.md](api.md). The examples below use Chinese visible text; use the person's language in actual work orders.

## Turn a need into a clear request

Identify the decision the AI needs to make, then the missing action or observation that only the person can supply. Ask for that evidence, using controls suited to its shape. The person should be able to understand the request without searching the conversation for an unstated target, instruction or completion condition.

Use the existing fields with distinct jobs:

| Field | What the person needs |
| --- | --- |
| `title` | A specific task, such as “查看保存后的提示”, instead of “帮忙确认一下”. |
| Ticket `description` | The target, relevant context, prerequisites and ordered actions. Put known page addresses, menu names and already established facts here. If a missing fact changes what the person should do, resolve it first; do not fabricate it. |
| Unit `label` | A short, specific action or question: “红色错误条数” or “保存后显示的提示”. |
| Unit `description` | Where to find the value, which unit to use, or what an attachment must show. Do not hide essential instructions in an example or placeholder. |
| `acceptance` | Observable completeness and evidence conditions the AI will assess. Describe the requested investigation, not a requirement for reality to match an expected positive outcome. |
| `required` | Whether the investigation truly needs this input. The UI already marks required/optional fields; do not duplicate the marker in every label. |

Write visible content as plain text. The current UI escapes HTML and does not render Markdown formatting in these fields. Use the actual button or menu wording, concise sentences and a sequence when order matters. Explain an unfamiliar acronym at its first necessary use. Do not paste API IDs, hashes or JSON instructions into the person's task unless they actually need to use them.

Specify time, quantities and evidence only as far as the task requires. A timestamp label should identify the event, such as “刷新页面的时间”, not just “时间”. Ask for the moment of the action, and explain that Get Time fills the current local time and remains editable. A number needs a stated unit when relevant; record an out-of-range observation faithfully rather than asking the person to adjust the answer. Do not invent measurement bounds.

For attachments, identify the useful region or file and why it is needed. A screenshot should show the relevant message and enough context to locate it, while excluding unrelated private content. Do not require both a full transcription and the full image unless each serves a separate review need. Uploading and clicking × are already handled by the app; explain these controls only when that helps the task.

There is no conditional visibility or conditional-required feature. For example, an explanation requested only for an abnormal result can be an optional text unit or the existing submission note, with the conditional instruction stated in plain language and checked by the AI. Do not mark it globally required while telling normal-result users to leave it blank. For multiple choice, no option-exclusivity logic is added by labels such as “none”.

## Avoid common traps

| Unhelpful request | Better approach |
| --- | --- |
| “检查一下是否正常，给我详细信息。” | Name the object, action and observation, then say which result or evidence to return. |
| Required checklist item “页面正常，没有报错” | Checklist actions such as “刷新一次页面”; use a choice for observed normal/abnormal/uncertain states. A required checklist is all-or-nothing, not a yes/no questionnaire. |
| “把数量、时间和原因都写在这里。” | Choose `number`, `timestamp` and, only if needed, a focused `text` question. |
| “请填入 5.0，证明设备正常。” | Request the actual measurement and its unit. If the measurement cannot be made, ask the person to report the blocker rather than enter an example value. |
| “截图要清晰。” | State which text, object or region must be readable and what context must remain visible. |
| “重新做完所有步骤并再传全部图片。” | Identify the missing evidence, reuse the completed observations, and append only the missing questions or upload area. |

There is no default quota of fields, checklist items, screenshots or paragraphs. A simple decision can need only one choice. Several unrelated errands should not become a single long checklist just to reduce ticket count. When a task cannot be performed, the person can save partial progress and use “无法完成”; missing required answers must not be filled with guesses, zeroes or fictional times.

## Complete examples

These are synthetic teaching examples, not instructions to perform real operations. The address, UI labels and prerequisites are assumptions for the examples. Replace them with verified project context and choose new request keys before actual use. JSON is for the agent to send; the person sees its labels and instructions in the web app. Each example uses only the controls its task needs. Across them, all six types are illustrated.

### 1. One observation: a choice is enough

```json
{
  "title": "查看预览页是否显示保存按钮",
  "description": "打开本项目测试页 http://127.0.0.1:3000/preview。查看页面右上角是否显示标有“保存”的按钮；这一步不用点击按钮。",
  "acceptance": "记录显示、未显示或无法判断的实际结果；如无法判断，在补充说明中写出原因。按钮未显示也是有效观察。",
  "source": "authoring-example",
  "request_key": "observe-button-001",
  "units": [
    {
      "id": "save_button", "type": "choice", "label": "右上角的保存按钮是否可见？", "required": true, "multiple": false,
      "options": [
        { "id": "visible", "label": "显示保存按钮" },
        { "id": "absent", "label": "未显示保存按钮" },
        { "id": "uncertain", "label": "无法判断" }
      ]
    }
  ]
}
```

For several independently applicable observations, use `choice` with `multiple: true` and clearly say “可多选”. Use `checklist` instead only when each item is an action to complete, rather than an observation to select. Keep these semantics visible in the wording, not just in the shape of the control.

### 2. Related actions, a count and an operation time

```json
{
  "title": "刷新测试页并记录控制台错误",
  "description": "在本项目测试页 http://127.0.0.1:3000/preview 中按 F12 打开浏览器开发者工具，切换到 Console（控制台）。清空原有消息，再刷新页面一次。记录这次刷新产生的红色错误条数和刷新时间，供 AI 对齐日志；不用复制整份日志。",
  "acceptance": "已按步骤刷新一次，记录本次红色错误条数与刷新时间；没有错误时填 0，不要求错误条数为 0 才能提交。如无法打开控制台，报告无法完成及原因。",
  "source": "authoring-example",
  "request_key": "console-observation-001",
  "units": [
    {
      "id": "refresh_steps", "type": "checklist", "label": "完成本次刷新", "required": true,
      "items": [
        { "id": "clear", "label": "在 Console（控制台）中清空原有消息" },
        { "id": "refresh", "label": "刷新测试页一次" }
      ]
    },
    { "id": "error_count", "type": "number", "label": "本次红色错误条数", "required": true, "unit": "条", "description": "只统计这次刷新后出现的红色错误；没有则填 0。" },
    { "id": "refreshed_at", "type": "timestamp", "label": "刷新页面的时间", "required": true, "description": "可在刷新时点击 Get Time；如果稍后填写，请手动调整为实际刷新时间。" }
  ]
}
```

The checklist records actions, the count records the observation, and the timestamp identifies the event. A version such as `001.20.0` or an identifier such as `000123` belongs in `text`, not `number`. Time is human-editable; it does not certify that the operation occurred at that instant. Counts have no integer-only constraint in the schema: instructions and AI review supply that interpretation.

### 3. A specific message and a useful screenshot

```json
{
  "title": "记录测试保存后出现的提示",
  "description": "在已打开的项目测试页，用已提供的测试数据点击一次“保存”。请记录随后出现的提示，帮助 AI 核对文字和显示位置；本例不要求操作真实业务数据。",
  "acceptance": "已说明保存后的实际提示或“未出现提示”，并提供能看到提示位置及附近界面的截图。成功、报错或无提示都按实际结果记录。",
  "source": "authoring-example",
  "request_key": "save-message-001",
  "units": [
    { "id": "message", "type": "text", "label": "保存后显示的提示", "required": true, "description": "记录提示的原文；没有提示时写“未出现提示”。这里只需提示文字，不必抄写整页。" },
    { "id": "screenshot", "type": "attachment", "label": "提示所在区域的截图", "required": true, "description": "保留提示及附近界面，确保文字可读；没有提示时截取操作后的页面。请排除其他窗口和无关私密内容，可在此区域直接粘贴截图。" }
  ]
}
```

Here the short text is needed to compare wording and the screenshot is needed to compare placement; they have distinct review purposes. If wording alone would answer the real question, omit the screenshot instead of copying this whole example.

## Return a specific gap, not the whole task

Describe what is already usable, what is missing and the minimum next action. Reuse earlier evidence where it answers the question. A useful return reason is “已能读出报错文字；截图裁掉了所属窗口，请补一张包含窗口标题和提示的截图，不必重做保存操作”, rather than “证据不够，请重新提交”.

The following is a return-request fragment, to be combined with the exact latest `version` and `submission_hash` read from the ticket:

```json
{
  "decision": "return",
  "reason": "已能读出报错文字；截图裁掉了所属窗口。请补一张包含窗口标题和提示的截图，不必重做保存操作。",
  "additional_units": [
    { "id": "message_context", "type": "attachment", "label": "包含窗口标题的提示截图", "required": true, "description": "保留窗口标题和完整提示，排除无关窗口或私密内容。" }
  ]
}
```

This fragment intentionally omits the version/hash; the agent must obtain them rather than invent them. Additional unit IDs must be new. New requirements apply to the next submission only. Original units remain in the form and prior answers carry forward; tell the person which additions need attention, without claiming that old required fields have been removed or disabled.
