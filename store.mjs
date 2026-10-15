import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, sha256, createArchive, verifyArchive, zipArchive } from './archive.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireCondition(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}
const now = () => new Date().toISOString();
const editable = ticket => ['pending', 'returned', 'blocked'].includes(ticket.status);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const types = ['checklist', 'text', 'number', 'choice', 'attachment'];

function validateRequest(input) {
  requireCondition(isObject(input), '请求必须是 JSON 对象');
  requireCondition(text(input.title) && input.title.length <= 200, '标题必填，最多 200 字');
  requireCondition(typeof input.description === 'string' && typeof input.acceptance === 'string', 'description 和 acceptance 必须是文本');
  requireCondition(text(input.source) && text(input.request_key), 'source 和 request_key 必填');
  requireCondition(Array.isArray(input.units) && input.units.length > 0, '至少需要一个任务单元');
  const ids = new Set();
  for (const unit of input.units) {
    requireCondition(isObject(unit) && typeof unit.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(unit.id) && !['__proto__', 'constructor', 'prototype'].includes(unit.id) && !ids.has(unit.id), '单元 ID 必须唯一且仅含字母、数字、下划线或连字符，不能使用对象保留键');
    ids.add(unit.id);
    requireCondition(types.includes(unit.type) && text(unit.label), '任务单元类型或标题无效');
    requireCondition(typeof unit.required === 'boolean', 'required 必须是布尔值');
    requireCondition(unit.description === undefined || typeof unit.description === 'string', '单元说明必须是文本');
    if (unit.type === 'checklist' || unit.type === 'choice') {
      const options = unit.type === 'checklist' ? unit.items : unit.options;
      requireCondition(Array.isArray(options) && options.length > 0, 'Checklist 或选择项不能为空');
      const optionIds = new Set();
      for (const option of options) {
        requireCondition(isObject(option) && text(option.id) && text(option.label) && !optionIds.has(option.id), '选项需要唯一 ID 和标题');
        optionIds.add(option.id);
      }
      if (unit.type === 'choice') requireCondition(typeof unit.multiple === 'boolean', 'multiple 必须是布尔值');
    }
    if (unit.type === 'number') requireCondition(unit.unit === undefined || typeof unit.unit === 'string', '单位必须是文本');
  }
}

function validateAnswers(ticket, answers, submitting) {
  requireCondition(isObject(answers), 'answers 必须是对象');
  const units = new Map(ticket.units.map(unit => [unit.id, unit]));
  for (const [id, value] of Object.entries(answers)) {
    const unit = units.get(id);
    requireCondition(unit, `未知任务单元：${id}`);
    if (unit.type === 'text') requireCondition(typeof value === 'string', `${unit.label} 需要文本`);
    else if (unit.type === 'number') requireCondition(value === null || (typeof value === 'number' && Number.isFinite(value)), `${unit.label} 需要数值`);
    else {
      requireCondition(Array.isArray(value) && value.every(v => typeof v === 'string') && new Set(value).size === value.length, `${unit.label} 需要无重复的 ID 数组`);
      const allowed = unit.type === 'attachment'
        ? ticket.attachments.filter(a => a.unit_id === id).map(a => a.id)
        : (unit.type === 'checklist' ? unit.items : unit.options).map(o => o.id);
      requireCondition(value.every(v => allowed.includes(v)), `${unit.label} 包含无效选项或附件`);
      if (unit.type === 'choice' && !unit.multiple) requireCondition(value.length <= 1, `${unit.label} 只能单选`);
    }
  }
  if (!submitting) return;
  for (const unit of ticket.units.filter(unit => unit.required)) {
    const value = answers[unit.id];
    let complete;
    if (unit.type === 'text') complete = text(value);
    else if (unit.type === 'number') complete = typeof value === 'number' && Number.isFinite(value);
    else if (unit.type === 'checklist') complete = Array.isArray(value) && value.length === unit.items.length;
    else complete = Array.isArray(value) && value.length > 0;
    requireCondition(complete, `请完成必填项：${unit.label}`, 422);
  }
}

export class Store {
  constructor(root) {
    this.root = root;
    this.attachmentsRoot = join(root, 'attachments');
    this.archivesRoot = join(root, 'archives');
    mkdirSync(this.attachmentsRoot, { recursive: true });
    mkdirSync(this.archivesRoot, { recursive: true });
    const tokenPath = join(root, 'api-token');
    if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.token = readFileSync(tokenPath, 'utf8').trim();
    this.db = new DatabaseSync(join(root, 'workorders.sqlite'));
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tickets (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
        document TEXT NOT NULL, UNIQUE(source, request_key)
      );`);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id) {
    requireCondition(/^TK-\d{6,}$/.test(id), '工单不存在', 404);
    const row = this.db.prepare('SELECT document FROM tickets WHERE seq = ?').get(Number(id.slice(3)));
    requireCondition(row, '工单不存在', 404);
    return JSON.parse(row.document);
  }
  save(ticket, timestamp = now()) {
    ticket.revision++;
    ticket.updated_at = timestamp;
    this.db.prepare('UPDATE tickets SET document = ? WHERE seq = ?').run(JSON.stringify(ticket), Number(ticket.id.slice(3)));
    return ticket;
  }
  event(ticket, type, actor, details = {}) {
    ticket.events.push({ type, actor, at: now(), ...details });
  }
  checkRevision(ticket, revision) {
    requireCondition(Number.isInteger(revision), '需要 revision 版本号');
    requireCondition(ticket.revision === revision, '工单已被更新，请重新载入后再操作', 409);
  }
  create(input) {
    validateRequest(input);
    const fingerprint = sha256(canonical(input));
    const previous = this.db.prepare('SELECT document, request_hash FROM tickets WHERE source = ? AND request_key = ?').get(input.source, input.request_key);
    if (previous) {
      requireCondition(previous.request_hash === fingerprint, '相同请求标识已用于不同内容', 409);
      return { ticket: JSON.parse(previous.document), created: false };
    }
    const ticket = this.transaction(() => {
      const result = this.db.prepare('INSERT INTO tickets (source, request_key, request_hash, document) VALUES (?, ?, ?, ?)')
        .run(input.source, input.request_key, fingerprint, '{}');
      const time = now();
      const document = {
        id: `TK-${String(result.lastInsertRowid).padStart(6, '0')}`,
        title: input.title.trim(), description: input.description, acceptance: input.acceptance,
        source: input.source, request_key: input.request_key, units: input.units,
        status: 'pending', revision: 0, created_at: time, updated_at: time,
        draft: { answers: {}, note: '', blocked_reason: '' }, attachments: [], submissions: [], reviews: [], events: [], archive_hash: null,
      };
      this.event(document, 'created', 'agent');
      return this.save(document);
    });
    return { ticket, created: true };
  }
  list({ status, source, q = '' } = {}) {
    const tickets = this.db.prepare('SELECT document FROM tickets ORDER BY seq DESC').all().map(row => JSON.parse(row.document));
    return tickets.filter(t => (!status || t.status === status) && (!source || t.source === source)
      && (!q || `${t.id} ${t.title} ${t.source} ${t.archive_hash || ''}`.toLowerCase().includes(q.toLowerCase())))
      .map(t => ({ id: t.id, title: t.title, source: t.source, description: t.description,
        status: t.status, revision: t.revision, created_at: t.created_at, updated_at: t.updated_at,
        unit_count: t.units.length, submission_count: t.submissions.length, archive_hash: t.archive_hash }));
  }
  updateDraft(id, input) {
    const ticket = this.get(id);
    requireCondition(editable(ticket), '当前工单不可编辑', 409);
    this.checkRevision(ticket, input.revision);
    validateAnswers(ticket, input.answers, false);
    requireCondition(typeof input.note === 'string', '备注必须是文本');
    ticket.draft.answers = input.answers;
    ticket.draft.note = input.note;
    return this.save(ticket);
  }
  upload(id, unitId, filename, mime, bytes, revision) {
    const ticket = this.get(id);
    requireCondition(editable(ticket), '当前工单不可上传', 409);
    this.checkRevision(ticket, revision);
    requireCondition(ticket.units.some(u => u.id === unitId && u.type === 'attachment'), '附件任务单元不存在');
    requireCondition(text(filename) && filename.length <= 255, '文件名必填且最多 255 字符');
    requireCondition(bytes.length > 0, '不支持空文件');
    const attachment = { id: randomUUID(), unit_id: unitId, name: filename, mime, size: bytes.length, sha256: sha256(bytes), created_at: now() };
    writeFileSync(join(this.attachmentsRoot, attachment.id), bytes, { flag: 'wx' });
    ticket.attachments.push(attachment);
    const answer = ticket.draft.answers[unitId] || [];
    ticket.draft.answers[unitId] = [...answer, attachment.id];
    this.event(ticket, 'attachment_added', 'human', { attachment_id: attachment.id });
    return this.save(ticket);
  }
  attachment(id, attachmentId) {
    const ticket = this.get(id);
    const metadata = ticket.attachments.find(a => a.id === attachmentId);
    requireCondition(metadata, '附件不存在', 404);
    const bytes = readFileSync(join(this.attachmentsRoot, metadata.id));
    requireCondition(sha256(bytes) === metadata.sha256, '附件完整性校验失败，文件内容已改变', 409);
    return { metadata, bytes };
  }
  submit(id, input) {
    const ticket = this.get(id);
    requireCondition(editable(ticket), '当前工单不可提交', 409);
    this.checkRevision(ticket, input.revision);
    validateAnswers(ticket, ticket.draft.answers, true);
    for (const unit of ticket.units.filter(u => u.type === 'attachment')) {
      for (const attachmentId of ticket.draft.answers[unit.id] || []) this.attachment(id, attachmentId);
    }
    const body = { version: ticket.submissions.length + 1, submitted_at: now(), answers: ticket.draft.answers, note: ticket.draft.note };
    ticket.submissions.push({ ...body, hash: sha256(canonical(body)) });
    ticket.status = 'submitted';
    ticket.draft.blocked_reason = '';
    this.event(ticket, 'submitted', 'human', { version: body.version });
    return this.save(ticket);
  }
  block(id, input) {
    const ticket = this.get(id);
    requireCondition(editable(ticket), '当前工单不可报告阻塞', 409);
    this.checkRevision(ticket, input.revision);
    requireCondition(text(input.reason), '请填写无法完成的原因');
    ticket.status = 'blocked'; ticket.draft.blocked_reason = input.reason;
    this.event(ticket, 'blocked', 'human', { reason: input.reason });
    return this.save(ticket);
  }
  resume(id, input) {
    const ticket = this.get(id);
    requireCondition(ticket.status === 'blocked', '工单当前没有阻塞', 409);
    this.checkRevision(ticket, input.revision);
    ticket.status = ticket.submissions.length ? 'returned' : 'pending';
    ticket.draft.blocked_reason = '';
    this.event(ticket, 'resumed', 'human');
    return this.save(ticket);
  }
  review(id, input) {
    const ticket = this.get(id), submission = ticket.submissions.at(-1);
    requireCondition(ticket.status === 'submitted', '工单当前不在待验收状态', 409);
    requireCondition(input.version === submission.version && input.submission_hash === submission.hash, '提交版本或哈希已过期，请重新读取工单', 409);
    requireCondition(['accept', 'return'].includes(input.decision), 'decision 需要 accept 或 return');
    requireCondition(text(input.reason), '验收必须填写理由');
    const time = now();
    ticket.reviews.push({ version: submission.version, submission_hash: submission.hash, decision: input.decision, reason: input.reason, at: time, actor: 'agent' });
    this.event(ticket, input.decision === 'accept' ? 'accepted' : 'returned', 'agent', { version: submission.version, reason: input.reason });
    if (input.decision === 'return') {
      ticket.status = 'returned';
      return this.save(ticket);
    }
    ticket.status = 'archived'; ticket.updated_at = time;
    this.event(ticket, 'archived', 'system');
    ticket.archive_hash = createArchive(this.archivesRoot, ticket, a => readFileSync(join(this.attachmentsRoot, a.id)));
    return this.save(ticket, time);
  }
  cancel(id, input) {
    const ticket = this.get(id);
    requireCondition(!['archived', 'cancelled'].includes(ticket.status), '当前工单不可取消', 409);
    this.checkRevision(ticket, input.revision);
    requireCondition(text(input.reason), '取消必须填写理由');
    ticket.status = 'cancelled';
    this.event(ticket, 'cancelled', 'agent', { reason: input.reason });
    return this.save(ticket);
  }
  archive(hash) {
    requireCondition(/^[a-f0-9]{64}$/.test(hash), '需要完整的 SHA-256 哈希');
    const folder = join(this.archivesRoot, hash);
    requireCondition(existsSync(folder), '归档包不存在', 404);
    return { folder, verification: verifyArchive(this.archivesRoot, hash) };
  }
  archiveInfo(hash) {
    const { folder, verification } = this.archive(hash);
    // 校验失败时不把被修改的 JSON 当作可信业务数据返回。
    return { ...verification, ticket: verification.valid ? JSON.parse(readFileSync(join(folder, 'ticket.json'), 'utf8')) : null };
  }
  exportArchive(hash) {
    const { folder, verification } = this.archive(hash);
    requireCondition(verification.valid, `归档校验失败：${verification.errors.join('；')}`, 409);
    return zipArchive(folder);
  }
}
