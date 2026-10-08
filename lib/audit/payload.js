import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const fields = [
  '审计ID', '时间', '操作人', '角色', '动作', '对象', '结果', 'IP', '备注',
];
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function unavailable() {
  return Object.assign(
    new Error('审计记录无法安全封装或恢复，已停止处理。'),
    { code: 'audit_payload_unavailable' },
  );
}

function context({ secret, baseUuid } = {}) {
  if (
    typeof secret !== 'string'
    || secret.length < 32
    || typeof baseUuid !== 'string'
    || !uuidPattern.test(baseUuid)
  ) {
    throw unavailable();
  }

  return {
    secret,
    baseUuid,
    key: createHmac('sha256', secret)
      .update('nju-redcross/audit-payload/v1')
      .digest(),
  };
}

function normalize(row) {
  if (
    !row || typeof row !== 'object' || Array.isArray(row)
    || Object.keys(row).some(key => !fields.includes(key))
    || fields.some(key => typeof row[key] !== 'string')
    || !row['审计ID'] || row['审计ID'].length > 200
    || !Number.isFinite(Date.parse(row['时间']))
  ) {
    throw unavailable();
  }

  const normalized = Object.fromEntries(fields.map(key => [key, row[key]]));
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 64 * 1024) {
    throw unavailable();
  }
  return normalized;
}

function fingerprint(row, ctx) {
  return createHmac('sha256', ctx.secret)
    .update(JSON.stringify(['audit/v1', ctx.baseUuid, row]))
    .digest('hex');
}

function associatedData(envelope, ctx) {
  return Buffer.from(JSON.stringify([
    1,
    ctx.baseUuid,
    envelope.auditId,
    envelope.fingerprint,
  ]));
}

export function sealAuditPayload(row, options) {
  const ctx = context(options);
  const normalized = normalize(row);
  const envelope = {
    version: 1,
    auditId: normalized['审计ID'],
    fingerprint: fingerprint(normalized, ctx),
  };

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ctx.key, iv);
  cipher.setAAD(associatedData(envelope, ctx));

  const data = Buffer.concat([
    cipher.update(JSON.stringify(normalized), 'utf8'),
    cipher.final(),
  ]);

  return {
    ...envelope,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}

export function openAuditPayload(envelope, options) {
  try {
    const ctx = context(options);
    if (
      !envelope || envelope.version !== 1
      || typeof envelope.auditId !== 'string'
      || !envelope.auditId || envelope.auditId.length > 200
      || !/^[a-f0-9]{64}$/.test(envelope.fingerprint || '')
      || !/^[a-f0-9]{24}$/.test(envelope.iv || '')
      || !/^[a-f0-9]{32}$/.test(envelope.tag || '')
      || typeof envelope.data !== 'string'
      || !/^(?:[a-f0-9]{2})+$/.test(envelope.data)
      || envelope.data.length > 128 * 1024
    ) {
      throw unavailable();
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      ctx.key,
      Buffer.from(envelope.iv, 'hex'),
    );
    decipher.setAAD(associatedData(envelope, ctx));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));

    const bytes = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'hex')),
      decipher.final(),
    ]);
    const row = normalize(JSON.parse(bytes.toString('utf8')));

    if (
      row['审计ID'] !== envelope.auditId
      || fingerprint(row, ctx) !== envelope.fingerprint
    ) {
      throw unavailable();
    }

    return row;
  } catch {
    throw unavailable();
  }
}