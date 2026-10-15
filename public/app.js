const icons = {
  logo: '<path d="M4 5h10M4 12h7M4 19h7m3-3 3 3 5-8"/>',
  inbox: '<path d="m4 4-2 10v6h20v-6L20 4ZM2 14h6l2 3h4l2-3h6"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8m-10 4h6"/>',
  link: '<path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 2 4 5v6c0 6 8 11 8 11s8-5 8-11V5Zm-4 9 3 3 5-6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 9m0-14v6h-6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const statusNames = { pending: '待处理', submitted: '待验收', returned: '需补充', blocked: '无法完成', archived: '已归档', cancelled: '已取消' };
const eventNames = { created: 'AI 发起工单', attachment_added: '上传附件', attachment_deleted: '删除未提交附件', attachment_removed: '附件移出本次提交', submitted: '提交完成', returned: 'AI 退回补充', accepted: 'AI 验收通过', archived: '工单归档', blocked: '报告无法完成', resumed: '恢复处理', cancelled: '取消工单' };
const date = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const badge = status => `<span class="badge ${status}">${statusNames[status]}</span>`;
const canEdit = ticket => ['pending', 'returned', 'blocked'].includes(ticket.status);
const state = { tickets: [], ticket: null, filter: 'all', q: '', dirty: false, busy: false, archive: null, connected: false, updatePending: false, project: null };
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let toastTimer, stream, routeVersion = 0, activeHash = location.hash;

async function api(path, options = {}) {
  const request = { ...options };
  if (options.body && !(options.body instanceof File)) {
    request.headers = { 'Content-Type': 'application/json', ...options.headers };
    request.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, request);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = document.querySelector('#toast');
  el.textContent = message; el.className = `toast${error ? ' error' : ''}`; el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 6500 : 3200);
}
async function run(operation) {
  if (state.busy) return;
  state.busy = true;
  document.querySelector('#ticket-form')?.setAttribute('inert', '');
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await operation(); }
  catch (error) { toast(error.message, true); }
  finally {
    state.busy = false;
    document.querySelector('#ticket-form')?.removeAttribute('inert');
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
function nav() {
  const route = location.hash.slice(1), pending = state.tickets.filter(t => ['pending', 'returned', 'blocked'].includes(t.status)).length;
  const item = (href, symbol, label, count, active) => `<a class="nav-item${active ? ' active' : ''}" href="#${href}">${icon(symbol)}${label}${count !== null ? `<span class="nav-count">${count}</span>` : ''}</a>`;
  return `<aside class="sidebar">
    <a class="brand" href="#all"><span class="brand-mark">${icon('logo')}</span><span><strong>Human Use</strong><small>HUMAN IN THE LOOP</small></span></a>
    <div class="nav-label">工作空间 <span class="unread-total">${unreadTotal()}</span></div><nav class="nav">
      ${item('all', 'list', '全部工单', state.tickets.length, !route || route === 'all' || route.startsWith('ticket/'))}
      ${item('pending', 'inbox', '待我处理', pending, route === 'pending')}
      ${item('submitted', 'clock', '等待验收', state.tickets.filter(t => t.status === 'submitted').length, route === 'submitted')}
      ${item('archives', 'archive', '归档记录', state.tickets.filter(t => t.status === 'archived').length, route.startsWith('archive'))}
    </nav>
    <div class="sidebar-bottom"><div class="local-tag"><span class="dot"></span>仅在本机运行</div><p>工单、附件与归档保存在本机<br>每一次协作，都有据可查。</p></div>
  </aside>`;
}
function shell(content, breadcrumb = '工单管理') {
  app.innerHTML = `<div class="shell">${nav()}<div class="workspace"><header class="topbar"><div class="breadcrumb">${escape(state.project?.name || '工作空间')} ${icon('chevron')} <span>${escape(breadcrumb)}</span></div><div class="topbar-right"><span class="connection"><span class="dot"></span>本地服务已连接</span><span class="avatar" title="本机操作者">我</span></div></header><main class="main">${content}</main></div></div>`;
  updateConnection();
}
function unreadTotal() { const count = state.tickets.reduce((sum, t) => sum + (t.unread_count || 0), 0); return count ? `${count} 条未读` : ''; }
function updateUnreadMarkers() {
  const total = document.querySelector('.unread-total'); if (total) total.textContent = unreadTotal();
  for (const ticket of state.tickets) {
    const link = document.querySelector(`.ticket-table .ticket-title[href="#ticket/${ticket.id}"]`);
    if (!link) continue;
    link.parentElement.querySelector('.unread-badge')?.remove();
    if (ticket.unread_count) {
      const marker = document.createElement('span'); marker.className = 'unread-badge'; marker.textContent = ticket.status === 'pending' ? '新' : '有更新'; link.after(marker);
    }
  }
}
function updateConnection() {
  const el = document.querySelector('.connection');
  if (el) { el.textContent = state.connected ? '● 实时连接' : '○ 正在重新连接'; el.classList.toggle('disconnected', !state.connected); }
}
function empty(title, message, action = '') {
  return `<div class="empty"><div class="empty-icon">${icon('inbox')}</div><h2>${escape(title)}</h2><p>${escape(message)}</p>${action}</div>`;
}
function matchingTickets() {
  return state.tickets.filter(t => {
    const filter = state.filter;
    const matchesFilter = filter === 'all' || (filter === 'pending' ? ['pending', 'returned', 'blocked'].includes(t.status) : t.status === filter);
    return matchesFilter && `${t.id} ${t.title} ${t.source} ${t.archive_hash || ''}`.toLowerCase().includes(state.q.toLowerCase());
  });
}
function table() {
  const tickets = matchingTickets();
  if (!tickets.length) return empty(state.tickets.length ? '这里暂时没有工单' : '准备好，接住 AI 交给你的一步', state.tickets.length ? '试试其他状态，或者换一个搜索关键词。' : 'AI 发起请求后，工单会出现在这里。');
  return `<div class="table-scroll"><table class="ticket-table"><thead><tr><th>工单 / 任务</th><th class="source-col">来源</th><th>状态</th><th class="date-col">最近更新</th><th></th></tr></thead><tbody>${tickets.map(t => `<tr><td><a class="ticket-title" href="#ticket/${t.id}">${escape(t.title)}</a>${t.unread_count ? `<span class="unread-badge">${t.status === 'pending' ? '新' : '有更新'}</span>` : ''}<div class="ticket-meta"><span class="mono">${t.id}</span><span>·</span><span>${t.unit_count} 个任务单元</span>${t.submission_count ? `<span>· 第 ${t.submission_count} 次提交</span>` : ''}</div></td><td class="source-col"><span class="source">${icon('link')}${escape(t.source)}</span></td><td>${badge(t.status)}</td><td class="muted date-col">${date(t.updated_at)}</td><td><a class="row-link" href="#ticket/${t.id}">${canEdit(t) ? '去处理' : '查看'} ${icon('arrow')}</a></td></tr>`).join('')}</tbody></table></div>`;
}
function renderList() {
  const processing = state.tickets.filter(t => ['pending', 'returned', 'blocked'].includes(t.status)).length;
  const submitted = state.tickets.filter(t => t.status === 'submitted').length, archived = state.tickets.filter(t => t.status === 'archived').length;
  const tabs = [['all', '全部'], ['pending', '待处理'], ['submitted', '待验收'], ['returned', '需补充'], ['blocked', '无法完成'], ['cancelled', '已取消']];
  shell(`<div class="page-heading"><div><div class="eyebrow">HUMAN × AI COLLABORATION</div><h1>每一步协作，都有着落。</h1><p class="subtitle">处理 AI 发起的请求，把结果与证据交回下一步。</p></div><div class="actions"><button class="btn" data-action="refresh">${icon('refresh')}刷新</button></div></div>
    <div class="stats"><div class="stat"><div class="stat-icon">${icon('inbox')}</div><div><p class="stat-label">需要你处理</p><p class="stat-value">${processing}<span class="small muted"> 项</span></p></div><span class="stat-caption">等待人的一步</span></div><div class="stat"><div class="stat-icon">${icon('clock')}</div><div><p class="stat-label">等待 AI 验收</p><p class="stat-value">${submitted}<span class="small muted"> 项</span></p></div><span class="stat-caption">结果已经交回</span></div><div class="stat"><div class="stat-icon">${icon('archive')}</div><div><p class="stat-label">已完成归档</p><p class="stat-value">${archived}<span class="small muted"> 项</span></p></div><span class="stat-caption">协作形成闭环</span></div></div>
    <section class="panel"><div class="panel-toolbar"><div class="tabs">${tabs.map(([filter, label]) => `<button class="tab${state.filter === filter ? ' active' : ''}" data-filter="${filter}">${label}</button>`).join('')}</div><label class="search">${icon('search')}<input id="search" type="search" value="${escape(state.q)}" placeholder="搜索标题、来源或工单号" aria-label="搜索工单"></label></div><div id="ticket-table">${table()}</div><div class="panel-footer"><span id="list-count">共 ${matchingTickets().length} 张工单</span><span>人完成操作 · AI 验收结果 · 本机保留证据</span></div></section><p class="footnote">${icon('shield')}数据保存在本机。提交形成版本记录，AI 验收通过后生成归档包。</p>`);
}
function complete(unit, value) {
  if (unit.type === 'text' || unit.type === 'timestamp') return typeof value === 'string' && value.trim().length > 0;
  if (unit.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (unit.type === 'checklist') return Array.isArray(value) && value.length === unit.items.length;
  return Array.isArray(value) && value.length > 0;
}
function localTimestamp(value) {
  const d = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function attachmentList(ticket, unit, ids, editable) {
  const attachments = ticket.attachments.filter(a => a.unit_id === unit.id && (ids.includes(a.id)
    || (editable && !ticket.submissions.some(s => (s.answers[unit.id] || []).includes(a.id)))));
  return `<div class="attachment-list">${attachments.map(a => {
    const included = ids.includes(a.id), path = `/api/tickets/${ticket.id}/attachments/${a.id}`;
    const retained = ticket.submissions.some(s => (s.answers[unit.id] || []).includes(a.id));
    return `<div class="attachment">${['image/png','image/jpeg','image/webp','image/gif'].includes(a.mime) ? `<a href="${path}" target="_blank" rel="noopener"><img src="${path}" alt="${escape(a.name)}"></a>` : icon('file')}<div class="attachment-info"><a class="attachment-name" href="${path}?download=1">${escape(a.name)}</a><span class="small muted">${(a.size / 1024).toFixed(1)} KB${editable && !included ? ' · 未纳入本次提交' : ''}</span></div>${editable ? `<button type="button" class="attachment-remove" data-action="remove-attachment" data-attachment-id="${a.id}" data-retained="${retained}" aria-label="移除附件：${escape(a.name)}" title="${retained ? '移除附件，历史提交中的证据仍保留' : '删除附件'}"><span aria-hidden="true">×</span></button>` : ''}</div>`;
  }).join('')}</div>`;
}
function unitMarkup(ticket, unit, index) {
  const value = ticket.draft.answers[unit.id], editable = canEdit(ticket);
  let field = '';
  if (unit.type === 'text') field = editable ? `<textarea data-answer="${unit.id}" placeholder="填写你的回复…" aria-label="${escape(unit.label)}">${escape(value || '')}</textarea>` : `<div class="answer-text">${escape(value || '未填写')}</div>`;
  if (unit.type === 'timestamp') field = editable ? `<div class="timestamp-field"><input type="datetime-local" step="1" data-answer="${unit.id}" value="${value ? localTimestamp(value) : ''}" aria-label="${escape(unit.label)}"><button class="btn" type="button" data-action="get-time" data-unit="${unit.id}">Get Time</button></div>` : `<div class="answer-text">${value ? escape(localTimestamp(value).replace('T', ' ')) : '未填写'}</div>`;
  if (unit.type === 'number') field = editable ? `<div class="numeric"><input type="number" step="any" data-answer="${unit.id}" value="${value ?? ''}" aria-label="${escape(unit.label)}" placeholder="填写数值"><span>${escape(unit.unit || '')}</span></div>` : `<div class="answer-text">${value ?? '未填写'} ${escape(unit.unit || '')}</div>`;
  if (['checklist', 'choice'].includes(unit.type)) {
    const options = unit.type === 'checklist' ? unit.items : unit.options;
    field = options.map(option => `<label class="check-option"><input type="${unit.type === 'choice' && !unit.multiple ? 'radio' : 'checkbox'}" name="unit-${unit.id}" data-answer="${unit.id}" value="${escape(option.id)}"${(value || []).includes(option.id) ? ' checked' : ''}${editable ? '' : ' disabled'}><span>${escape(option.label)}</span></label>`).join('');
  }
  if (unit.type === 'attachment') field = `${editable ? `<div class="upload-zone" tabindex="0" role="group" data-paste="${unit.id}" aria-label="${escape(unit.label)}：粘贴图片" aria-keyshortcuts="Control+V Meta+V">${icon('upload')}<span>点击此处，按 Ctrl+V 粘贴截图</span><button class="btn" type="button" data-action="choose-file" data-unit="${unit.id}">或选择图片、文件</button><small>图片支持预览 · 每个文件最大 20 MB</small></div><input class="visually-hidden" type="file" multiple id="file-${unit.id}" data-upload="${unit.id}">` : ''}${attachmentList(ticket, unit, value || [], editable)}`;
  const added = ticket.reviews.find(review => review.additional_units?.some(added => added.id === unit.id));
  return `<section class="card unit"><div class="unit-header"><span class="unit-index">${String(index + 1).padStart(2, '0')}</span><div><h3>${escape(unit.label)}<span class="unit-required">${unit.required ? '必填' : '选填'}</span>${added ? `<span class="unit-supplement">第 ${added.version} 次提交后追加</span>` : ''}</h3>${unit.description ? `<p class="unit-description">${escape(unit.description)}</p>` : ''}</div></div>${field}</section>`;
}
function historyMarkup(ticket) {
  if (!ticket.submissions.length) return '';
  return `<details class="history"><summary>提交与验收记录（${ticket.submissions.length} 次提交）</summary>${[...ticket.submissions].reverse().map(submission => `<div class="submission-card"><div class="card-heading"><h3>第 ${submission.version} 次提交</h3><span class="small muted">${date(submission.submitted_at)}</span></div><div class="submission-hash mono">SHA-256 · ${submission.hash}</div>${(submission.units || ticket.units.filter(unit => !ticket.reviews.some(review => review.version >= submission.version && review.additional_units?.some(added => added.id === unit.id)))).map(unit => {
    const answer = submission.answers[unit.id];
    let display;
    if (unit.type === 'attachment') display = attachmentList(ticket, unit, answer || [], false);
    else if (unit.type === 'timestamp') display = `<p>${answer ? escape(localTimestamp(answer).replace('T', ' ')) : '未填写'}</p>`;
    else if (unit.type === 'checklist' || unit.type === 'choice') display = `<p>${escape((unit.type === 'checklist' ? unit.items : unit.options).filter(o => (answer || []).includes(o.id)).map(o => o.label).join('；') || '未填写')}</p>`;
    else display = `<p>${escape(answer ?? '未填写')}${unit.type === 'number' ? ' ' + escape(unit.unit || '') : ''}</p>`;
    return `<div class="history-answer"><strong>${escape(unit.label)}</strong>${display}</div>`;
  }).join('')}${submission.note ? `<div class="history-answer"><strong>补充说明</strong><p>${escape(submission.note)}</p></div>` : ''}${ticket.reviews.filter(r => r.version === submission.version).map(review => `<div class="banner ${review.decision === 'accept' ? 'success' : ''}"><strong>${review.decision === 'accept' ? 'AI 验收通过' : 'AI 退回补充'}</strong>${escape(review.reason)}${review.additional_units ? `<p>追加补充项：${review.additional_units.map(unit => escape(unit.label)).join('、')}</p>` : ''}</div>`).join('')}</div>`).join('')}</details>`;
}
function renderTicket() {
  const t = state.ticket, editable = canEdit(t), latestReview = t.reviews.at(-1);
  const count = t.units.filter(u => complete(u, t.draft.answers[u.id])).length;
  let notice = '';
  if (t.status === 'returned') notice = `<div class="banner"><strong>AI 希望你补充以下内容</strong>${escape(latestReview.reason)}</div>`;
  if (t.status === 'blocked') notice = `<div class="banner error"><strong>已报告无法完成</strong>${escape(t.draft.blocked_reason)}<div class="actions"><button class="btn" data-action="resume">恢复处理</button></div></div>`;
  if (t.status === 'submitted') notice = `<div class="banner"><strong>结果已提交，等待 AI 验收</strong>第 ${t.submissions.length} 次提交已保存。AI 可读取本次回答和附件，再通过接口验收或退回。</div>`;
  if (t.status === 'archived') notice = `<div class="banner success"><strong>协作已完成，工单已归档</strong>${escape(latestReview.reason)}<div class="actions"><a class="btn" href="#archive/${t.archive_hash}">${icon('archive')}查看归档包</a></div></div>`;
  if (t.status === 'cancelled') notice = `<div class="banner"><strong>工单已取消</strong>${escape(t.events.at(-1).reason)}</div>`;
  const step = t.status === 'archived' ? 3 : t.status === 'submitted' ? 2 : 1;
  shell(`<a class="back" href="#all">${icon('back')}返回工单列表</a><div class="detail-heading"><div class="detail-title"><h1>${escape(t.title)}</h1>${badge(t.status)}</div><div class="detail-meta"><span class="mono">${t.id}</span><span class="source">${icon('link')}${escape(t.source)}</span><span>创建于 ${date(t.created_at)}</span></div></div>
    <div class="detail-grid"><div class="detail-content">${notice}<section class="card"><div class="card-heading">${icon('info')}<h2>这次需要你做什么</h2></div><p>${escape(t.description || '按下面的任务单元完成操作。')}</p><div class="acceptance"><strong>验收标准</strong><p>${escape(t.acceptance || '由发起工单的 AI 根据提交结果验收。')}</p></div></section>
    <div class="task-topline"><span>任务清单</span><progress id="task-progress" value="${count}" max="${t.units.length}" aria-label="任务填写进度"></progress><span id="task-count" class="small">${count} / ${t.units.length} 项已填写</span></div>
    <form id="ticket-form">${t.units.map((unit, index) => unitMarkup(t, unit, index)).join('')}<section class="card note-card"><label for="note">补充说明 <span class="muted small">（选填）</span></label>${editable ? `<textarea id="note" placeholder="还有什么需要 AI 知道的？">${escape(t.draft.note)}</textarea>` : `<div class="answer-text">${escape(t.draft.note || '无补充说明')}</div>`}</section></form>
    ${editable ? `<div class="savebar"><span id="save-status" class="save-status">${state.dirty ? '有未保存的修改' : '草稿已保存到本机'}</span><div class="actions"><button class="btn quiet danger" data-action="block">无法完成</button><button class="btn" data-action="save">保存草稿</button><button class="btn primary" data-action="submit">提交完成 ${icon('arrow')}</button></div></div>` : ''}${historyMarkup(t)}</div>
    <aside class="detail-sidebar"><section class="card side-card"><h3>协作进度</h3><ol class="process">${['AI 发起请求', '人完成操作', 'AI 验收结果', '形成归档记录'].map((label, index) => `<li class="${index < step ? 'done' : index === step ? 'current' : ''}">${label}<small>${['任务与验收标准已明确', '填写结果并提交证据', '对本次提交进行判断', '完整工单包与内容哈希'][index]}</small></li>`).join('')}</ol></section>
    <section class="card side-card"><h3>工单信息</h3><dl><div class="side-pair"><dt>当前提交版本</dt><dd>${t.submissions.length ? `第 ${t.submissions.length} 次提交` : '尚未提交'}</dd></div><div class="side-pair"><dt>最近更新</dt><dd>${date(t.updated_at)}</dd></div><div class="side-pair"><dt>保存位置</dt><dd>本机 · ${t.attachments.length} 个附件</dd></div>${t.archive_hash ? `<div class="side-pair"><dt>归档哈希</dt><dd class="mono">${t.archive_hash}</dd></div>` : ''}</dl><p class="small muted">提交记录会保留。AI 验收通过后，工单将冻结归档。</p></section>
    <section class="card side-card"><h3>最近动态</h3><div class="timeline">${[...t.events].reverse().slice(0, 7).map(event => `<div class="event"><p>${eventNames[event.type]}${event.version ? ' · 第 ' + event.version + ' 版' : ''}</p><time>${date(event.at)}</time></div>`).join('')}</div></section></aside></div>`, '工单详情');
  document.querySelector('.detail-heading').insertAdjacentHTML('afterend', '<div id="live-update" class="banner live-update"' + (state.updatePending ? '' : ' hidden') + '><strong>这张工单有新动态</strong>当前填写内容已保留。<button class="btn" data-action="refresh">查看最新内容</button></div>');
  const activity = (t.activity || []).filter(e => e.type.startsWith('agent.')).map(e => ({ ...e, at: e.created_at }));
  document.querySelector('.timeline').innerHTML = [...t.events, ...activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7).map(event =>
    `<div class="event${event.type.startsWith('agent.') ? ' agent-activity' : ''}"><p>${escape(event.message ? 'AI · ' + event.message : eventNames[event.type])}${event.version ? ' · 第 ' + event.version + ' 版' : ''}</p><time>${date(event.at)}</time></div>`).join('');
}
function readForm() {
  const answers = {};
  for (const unit of state.ticket.units) {
    if (unit.type === 'attachment') {
      answers[unit.id] = state.ticket.draft.answers[unit.id] || [];
    } else {
      const elements = [...document.querySelectorAll('[data-answer]')].filter(el => el.dataset.answer === unit.id);
      if (unit.type === 'text') answers[unit.id] = elements[0].value;
      else if (unit.type === 'timestamp') {
        if (!elements[0].validity.valid) throw new Error(`${unit.label} 需要完整有效的日期和时间`);
        answers[unit.id] = elements[0].value ? new Date(elements[0].value).toISOString() : '';
      }
      else if (unit.type === 'number') {
        if (elements[0].validity.badInput) throw new Error(`${unit.label} 需要有效数值`);
        answers[unit.id] = elements[0].value === '' ? null : elements[0].valueAsNumber;
      } else answers[unit.id] = elements.filter(el => el.checked).map(el => el.value);
    }
  }
  return { answers, note: document.querySelector('#note').value };
}
function markDirty() {
  try { Object.assign(state.ticket.draft, readForm()); }
  catch (error) { toast(error.message, true); }
  state.dirty = true;
  const count = state.ticket.units.filter(u => complete(u, state.ticket.draft.answers[u.id])).length;
  document.querySelector('#save-status').textContent = '有未保存的修改';
  document.querySelector('#task-progress').value = count;
  document.querySelector('#task-count').textContent = `${count} / ${state.ticket.units.length} 项已填写`;
}
async function saveDraft() {
  const draft = readForm();
  state.ticket = await api(`/api/tickets/${state.ticket.id}/draft`, { method: 'POST', body: { revision: state.ticket.revision, ...draft } });
  state.dirty = false;
}
async function refreshList() { state.tickets = (await api('/api/tickets')).tickets; }
function renderArchives() {
  const archived = state.tickets.filter(t => t.status === 'archived');
  shell(`<div class="page-heading"><div><div class="eyebrow">LOCAL ARCHIVE</div><h1>为完成的协作，留一份凭据。</h1><p class="subtitle">按内容哈希查找工单包，检查证据，并导出完整记录。</p></div></div><section class="card"><div class="card-heading">${icon('search')}<h2>查找归档包</h2></div><p>粘贴完整的 SHA-256 哈希，读取本机保存的归档。</p><form id="archive-search" class="archive-search"><input name="hash" value="${escape(state.archive?.hash || '')}" placeholder="输入 64 位内容哈希" aria-label="归档哈希" required pattern="[a-f0-9]{64}"><button class="btn primary" type="submit">查找归档 ${icon('arrow')}</button></form></section><div id="archive-result">${state.archive ? archiveResult(state.archive) : ''}</div><h2 class="archive-title">已归档工单 <span class="small muted">${archived.length} 张</span></h2><section class="panel">${archived.length ? `<div class="table-scroll"><table class="ticket-table"><thead><tr><th>工单</th><th>内容哈希</th><th></th></tr></thead><tbody>${archived.map(t => `<tr><td><a class="ticket-title" href="#ticket/${t.id}">${escape(t.title)}</a><span class="small muted">${t.id} · ${date(t.updated_at)}</span></td><td class="mono muted">${t.archive_hash.slice(0, 12)}…</td><td><a class="row-link" href="#archive/${t.archive_hash}">查看归档 ${icon('arrow')}</a></td></tr>`).join('')}</tbody></table></div>` : empty('还没有归档记录', 'AI 验收通过后，完整工单包会保存在这里。')}</section><p class="footnote">${icon('shield')}哈希用于检查内容一致性，不代表物理操作证明或个人签名。</p>`, '归档记录');
}
function archiveResult(result) {
  return `<section class="card archive-result"><div class="banner ${result.valid ? 'success' : 'error'}"><strong>${result.valid ? '完整性校验通过' : '完整性校验失败'}</strong>${result.valid ? `${result.file_count} 个文件与清单一致，清单哈希与工单包标识一致。` : escape(result.errors.join('；'))}</div>${result.ticket ? `<h2>${escape(result.ticket.title)}</h2><p>${escape(result.ticket.id)} · ${escape(result.ticket.source)}</p>` : ''}<div class="hash-box">${result.hash}</div><div class="actions"><button class="btn" data-action="verify" data-hash="${result.hash}">${icon('refresh')}重新校验</button>${result.valid ? `<a class="btn primary" href="/api/archives/${result.hash}/download">${icon('download')}导出工单包 ZIP</a>` : ''}${result.ticket ? `<a class="btn" href="#ticket/${result.ticket.id}">查看工单</a>` : ''}</div></section>`;
}
function openBlock() {
  dialog.innerHTML = `<div class="dialog-header"><h2>报告无法完成</h2><button class="btn quiet" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><p>先保存当前进展，再告诉 AI 卡在哪里。无需完成所有必填项。</p><form id="block-form"><label for="block-reason">无法完成的原因</label><textarea id="block-reason" required placeholder="例如：缺少测量工具，无法读取实际电压。">${escape(state.ticket.draft.blocked_reason)}</textarea><div class="dialog-footer"><button class="btn" type="button" data-action="close-dialog">返回</button><button class="btn primary" type="submit">保存并报告</button></div></form>`;
  dialog.showModal();
}
async function route() {
  const version = ++routeVersion;
  state.dirty = false; state.q = ''; state.updatePending = false;
  const route = location.hash.slice(1) || 'all';
  try {
    await refreshList();
    if (version !== routeVersion) return;
    if (route.startsWith('ticket/')) {
      const ticket = await api(`/api/tickets/${encodeURIComponent(route.slice(7))}`);
      if (version !== routeVersion) return;
      state.ticket = ticket; renderTicket(); await markVisibleRead(ticket);
    } else if (route === 'archives' || route.startsWith('archive/')) {
      state.archive = route.startsWith('archive/') ? await api(`/api/archives/${encodeURIComponent(route.slice(8))}`) : null;
      if (version !== routeVersion) return;
      renderArchives();
    } else {
      state.filter = ['all','pending','submitted','returned','blocked','cancelled'].includes(route) ? route : 'all';
      renderList();
    }
  } catch (error) {
    shell(`<div class="error-state">${escape(error.message)}<p><a href="#all">返回工单列表</a></p></div>`);
  }
}
document.addEventListener('click', event => {
  const navigation = event.target.closest('a[href^="#"]');
  if (navigation && state.busy) { event.preventDefault(); return; }
  if (navigation && state.dirty && !navigation.dataset.action) {
    if (!confirm('还有未保存的修改，离开后这些修改会丢失。确定离开？')) { event.preventDefault(); return; }
    state.dirty = false;
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; renderList(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'close-dialog') { dialog.close(); return; }
  if (action === 'block') { openBlock(); return; }
  if (action === 'choose-file') { document.getElementById(`file-${button.dataset.unit}`).click(); return; }
  if (action === 'get-time') {
    document.querySelector(`[data-answer="${button.dataset.unit}"]`).value = localTimestamp(new Date().toISOString());
    markDirty(); return;
  }
  run(async () => {
    if (action === 'refresh') {
      if (state.dirty && !confirm('重新载入会丢弃未保存的修改。确定继续？')) return;
      await route(); toast('已更新');
    }
    if (action === 'save') { await saveDraft(); renderTicket(); toast('草稿已保存到本机'); }
    if (action === 'remove-attachment') {
      const retained = button.dataset.retained === 'true';
      await saveDraft();
      state.ticket = await api(`/api/tickets/${state.ticket.id}/attachments/${button.dataset.attachmentId}/remove`, { method: 'POST', body: { revision: state.ticket.revision } });
      await refreshList(); renderTicket(); toast(retained ? '已移出本次提交，历史证据仍保留' : '附件已删除');
    }
    if (action === 'submit') {
      await saveDraft();
      state.ticket = await api(`/api/tickets/${state.ticket.id}/submit`, { method: 'POST', body: { revision: state.ticket.revision } });
      // Replace the route directly so the busy guard cannot undo this navigation.
      activeHash = '#all';
      window.history.replaceState(null, '', location.pathname + location.search + activeHash);
      state.ticket = null;
      await route(); toast('已提交，等待 AI 验收');
    }
    if (action === 'resume') {
      await saveDraft();
      state.ticket = await api(`/api/tickets/${state.ticket.id}/resume`, { method: 'POST', body: { revision: state.ticket.revision } });
      await refreshList(); renderTicket(); toast('已恢复处理');
    }
    if (action === 'verify') {
      state.archive = await api(`/api/archives/${button.dataset.hash}/verify`);
      renderArchives(); toast(state.archive.valid ? '校验通过' : '校验失败：内容发生变化', !state.archive.valid);
    }
  });
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') {
    state.q = event.target.value;
    document.querySelector('#ticket-table').innerHTML = table();
    document.querySelector('#list-count').textContent = `共 ${matchingTickets().length} 张工单`;
  } else if (event.target.closest('#ticket-form') && !event.target.dataset.upload) markDirty();
});
function uploadFiles(unitId, files) {
  if (!files.length) return;
  return run(async () => {
    await saveDraft();
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB 上限`);
        const params = new URLSearchParams({ unit_id: unitId, name: file.name, revision: state.ticket.revision });
        state.ticket = await api(`/api/tickets/${state.ticket.id}/attachments?${params}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      }
      toast('附件已保存到本机');
    } finally { renderTicket(); }
  });
}
document.addEventListener('change', event => {
  if (event.target.dataset.upload) uploadFiles(event.target.dataset.upload, [...event.target.files]);
});
document.addEventListener('paste', event => {
  const target = event.target.closest('[data-paste]');
  if (!target || !canEdit(state.ticket)) return;
  const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
  if (!images.length) return;
  event.preventDefault();
  uploadFiles(target.dataset.paste, images);
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'archive-search') location.hash = `archive/${new FormData(event.target).get('hash').trim()}`;
  if (event.target.id === 'block-form') run(async () => {
    const reason = document.querySelector('#block-reason').value;
    await saveDraft();
    state.ticket = await api(`/api/tickets/${state.ticket.id}/block`, { method: 'POST', body: { revision: state.ticket.revision, reason } });
    dialog.close(); await refreshList(); renderTicket(); toast('已记录原因，AI 可以读取当前阻塞');
  });
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => {
  if (state.busy || (state.dirty && !confirm('还有未保存的修改，离开后这些修改会丢失。确定离开？'))) {
    window.history.replaceState(null, '', location.pathname + location.search + activeHash);
    return;
  }
  activeHash = location.hash;
  route();
});
async function markVisibleRead(ticket) {
  if (!ticket.last_event_id || document.hidden) return;
  await api('/api/tickets/' + ticket.id + '/read', { method: 'POST', body: { event_id: ticket.last_event_id } });
  await refreshList();
  const unread = document.querySelector('.unread-total');
  if (unread) unread.textContent = unreadTotal();
}
let eventTimer, processingEvents = false;
const receivedEvents = new Map();
function scheduleEvents() { clearTimeout(eventTimer); eventTimer = setTimeout(processEvents, 150); }
async function processEvents() {
  if (processingEvents) { scheduleEvents(); return; }
  processingEvents = true;
  const events = [...receivedEvents.values()]; receivedEvents.clear();
  const version = routeVersion, hash = location.hash;
  try {
    await refreshList();
    if (version !== routeVersion) return;
    const unread = document.querySelector('.unread-total');
    if (unread) unread.textContent = unreadTotal();
    const current = state.ticket && hash === '#ticket/' + state.ticket.id;
    const affecting = events.some(e => e.ticket_id === state.ticket?.id);
    if (current && affecting) {
      state.updatePending = true;
      if (state.busy || state.dirty || dialog.open || document.activeElement.matches('input,textarea,select,[data-paste]')) {
        const banner = document.querySelector('#live-update'); if (banner) banner.hidden = false;
      } else {
        const ticket = await api('/api/tickets/' + state.ticket.id);
        if (version === routeVersion && !state.dirty && !state.busy && !dialog.open) {
          state.ticket = ticket; state.updatePending = false; renderTicket(); await markVisibleRead(ticket);
        }
      }
    } else if (!current && !state.busy && !dialog.open && !document.activeElement.matches('input,textarea,select')) {
      if (hash.startsWith('#archive')) renderArchives(); else renderList();
    }
    const event = events.filter(e => e.actor !== 'human').at(-1);
    if (event) toast(event.title + ' · ' + (event.message || ({ 'ticket.created': 'AI 发来了新工单', 'review.returned': '需要补充', 'ticket.archived': '已验收归档', 'ticket.cancelled': '已取消' }[event.type] || '有新动态')));
  } catch (error) { toast('读取新动态失败：' + error.message, true); }
  finally { processingEvents = false; if (receivedEvents.size) scheduleEvents(); }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.ticket && location.hash === '#ticket/' + state.ticket.id && !state.updatePending) markVisibleRead(state.ticket).catch(error => toast(error.message, true));
});
async function start() {
  shell('<div class="loading">正在载入本机工作空间…</div>');
  const info = await api('/api/info');
  state.project = info.project;
  if (info.project) document.title = info.project.name + ' · Human Use';
  await route();
  stream = new EventSource('/api/events/stream?after=' + info.event_cursor);
  stream.addEventListener('ready', () => { state.connected = true; updateConnection(); });
  stream.addEventListener('read', () => { refreshList().then(updateUnreadMarkers).catch(error => toast(error.message, true)); });
  stream.onerror = () => { state.connected = false; updateConnection(); };
  stream.onmessage = message => { const event = JSON.parse(message.data); receivedEvents.set(event.event_id, event); scheduleEvents(); };
}
start().catch(error => { shell(empty('无法连接本机服务', error.message)); });
