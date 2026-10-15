import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { translate } from './public/i18n.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => JSON.stringify(sortKeys(value), null, 2) + '\n';

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  }
  return value;
}

export function createArchive(root, ticket, attachmentBytes) {
  const files = new Map();
  const json = (name, value) => files.set(name, Buffer.from(canonical(value)));
  json('ticket.json', {
    id: ticket.id, title: ticket.title, description: ticket.description, source: ticket.source,
    acceptance: ticket.acceptance, units: ticket.units, created_at: ticket.created_at,
    archived_at: ticket.updated_at, attachments: ticket.attachments,
  });
  for (const submission of ticket.submissions) json(`submissions/${submission.version}.json`, submission);
  json('reviews.json', ticket.reviews);
  json('events.json', ticket.events);
  for (const attachment of ticket.attachments) {
    const bytes = attachmentBytes(attachment);
    if (sha256(bytes) !== attachment.sha256) throw new Error(`附件已发生变化：${attachment.name}`);
    files.set(`attachments/${attachment.id}`, bytes);
  }
  const manifest = Buffer.from(canonical({
    format: 'local-workorder-v1',
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) })),
  }));
  const hash = sha256(manifest);
  const target = join(root, hash);
  if (!existsSync(target)) {
    const staging = join(root, `.pending-${hash}`);
    mkdirSync(staging, { recursive: true });
    for (const [name, bytes] of files) {
      mkdirSync(dirname(join(staging, name)), { recursive: true });
      writeFileSync(join(staging, name), bytes);
    }
    writeFileSync(join(staging, 'manifest.json'), manifest);
    renameSync(staging, target);
  }
  const verification = verifyArchive(root, hash);
  if (!verification.valid) throw new Error(`归档校验失败：${verification.errors.join('；')}`);
  return hash;
}

export function archiveFiles(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? archiveFiles(join(folder, entry.name), name + '/') : [name];
  }).sort();
}

export function verifyArchive(root, hash, language = 'zh-CN') {
  const tr = (key, values) => translate(language, key, values);
  const folder = join(root, hash);
  const errors = [];
  const manifestPath = join(folder, 'manifest.json');
  if (!existsSync(manifestPath)) return { hash, valid: false, errors: [tr('缺少 manifest.json')] };
  const bytes = readFileSync(manifestPath);
  if (sha256(bytes) !== hash) return { hash, valid: false, errors: [tr('清单哈希与工单包标识不符')] };
  const manifest = JSON.parse(bytes);
  const expected = new Set(['manifest.json']);
  for (const file of manifest.files) {
    // 清单是归档的外部读取边界；只允许包内相对路径。
    if (!/^(ticket\.json|reviews\.json|events\.json|submissions\/[1-9]\d*\.json|attachments\/[a-f0-9-]+)$/.test(file.path)) {
      errors.push(tr('非法包内路径：{path}', { path: file.path }));
      continue;
    }
    expected.add(file.path);
    const path = join(folder, file.path);
    if (!existsSync(path)) errors.push(tr('缺少文件：{path}', { path: file.path }));
    else {
      const content = readFileSync(path);
      if (content.length !== file.size || sha256(content) !== file.sha256) errors.push(tr('文件内容不符：{path}', { path: file.path }));
    }
  }
  for (const name of archiveFiles(folder)) if (!expected.has(name)) errors.push(tr('存在额外文件：{path}', { path: name }));
  return { hash, valid: errors.length === 0, errors, file_count: manifest.files.length };
}

// ZIP 的无压缩存储模式：保持依赖为零，包的内容标识由 manifest 决定。
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipArchive(folder) {
  const local = [], central = [];
  let offset = 0;
  for (const path of archiveFiles(folder)) {
    const name = Buffer.from(path), bytes = readFileSync(join(folder, path)), crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8); record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20); record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
    central.push(record, name); offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
