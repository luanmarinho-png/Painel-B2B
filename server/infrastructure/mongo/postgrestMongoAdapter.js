/**
 * Adaptador limitado PostgREST → MongoDB para o admin-proxy.
 * Cobre os padrões usados pelo admin.html (eq, or, like, is.null, limit, offset, order, on_conflict).
 */

const { MongoClient } = require('mongodb');
const { getMongoEnv } = require('./mongoEnv');

/** @type {MongoClient | null} */
let _client = null;

/**
 * Cliente reutilizado entre invocações; se a topologia foi fechada (idle, rede, Lambda),
 * recria para evitar "Topology is closed". Só usa isDestroyed — não isConnected (evita
 * correr durante STATE_CONNECTING).
 *
 * @param {import('mongodb').MongoClient | null} client
 * @returns {boolean}
 */
function isMongoClientUsable(client) {
  if (!client) return false;
  const t = client.topology;
  if (!t) return false;
  if (typeof t.isDestroyed === 'function' && t.isDestroyed()) return false;
  return true;
}

/**
 * @returns {Promise<void>}
 */
async function resetMongoClient() {
  if (!_client) return;
  try {
    await _client.close();
  } catch (_) {
    /* já fechado */
  }
  _client = null;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isTopologyClosedError(err) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err);
  return /topology is closed|connection.*closed|pool.*closed/i.test(msg);
}

/**
 * @returns {Promise<import('mongodb').Db>}
 */
async function getDb() {
  const { uri, databaseName } = getMongoEnv();
  if (!uri) throw new Error('MONGODB_URI não configurada');
  if (!isMongoClientUsable(_client)) {
    await resetMongoClient();
    _client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 12000,
      maxPoolSize: 10,
      minPoolSize: 0
    });
    await _client.connect();
  }
  return _client.db(databaseName);
}

/**
 * @param {string} table
 * @param {string} query
 * @returns {string}
 */
function fullQueryString(table, query) {
  const t = String(table || '');
  const q = String(query || '');
  if (t.includes('?')) {
    const rest = t.split('?').slice(1).join('?');
    return q ? `${rest}&${q}` : rest;
  }
  return q;
}

/**
 * @param {string} name
 * @returns {string}
 */
function collectionName(name) {
  return String(name || '').split('?')[0].split('/')[0].trim();
}

/**
 * @param {string} s
 * @returns {string}
 */
function dec(s) {
  try {
    return decodeURIComponent(String(s).replace(/\+/g, ' '));
  } catch {
    return String(s);
  }
}

/**
 * @param {string} rhs
 * @returns {{ op: string, value?: unknown, fieldOp?: string } | null}
 */
/**
 * @param {string} field
 * @param {unknown} val
 * @returns {unknown}
 */
function coerceFieldValue(field, val) {
  if (field === 'id' && typeof val === 'string' && /^\d+$/.test(val)) return Number(val);
  return val;
}

function parseRhs(rhs, fieldForCoerce) {
  const r = String(rhs);
  if (r === 'is.null') return { op: 'eq', value: null };
  if (r === 'is.not.null' || r === 'not.is.null') return { op: 'ne', value: null };

  const inM = r.match(/^in\.\((.+)\)$/s);
  if (inM) {
    const vals = inM[1].split(',').map((x) => coerceFieldValue(fieldForCoerce, dec(x.trim())));
    return { op: 'in', value: vals };
  }

  const m = r.match(/^(eq|neq|gt|gte|lt|lte|like|ilike)\.(.+)$/s);
  if (m) {
    let v = dec(m[2]);
    if (m[1] === 'eq' || m[1] === 'neq') {
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
    }
    v = coerceFieldValue(fieldForCoerce, v);
    return { op: m[1], value: v };
  }
  return null;
}

/**
 * @param {string} field
 * @param {{ op: string, value?: unknown }} p
 * @returns {Record<string, unknown>}
 */
function condToMongo(field, p) {
  if (p.op === 'eq') return { [field]: p.value };
  if (p.op === 'ne') return { [field]: { $ne: null } };
  if (p.op === 'neq') return { [field]: { $ne: p.value } };
  if (p.op === 'gt') return { [field]: { $gt: p.value } };
  if (p.op === 'gte') return { [field]: { $gte: p.value } };
  if (p.op === 'lt') return { [field]: { $lt: p.value } };
  if (p.op === 'lte') return { [field]: { $lte: p.value } };
  if (p.op === 'in') return { [field]: { $in: p.value } };
  if (p.op === 'like' || p.op === 'ilike') {
    const raw = String(p.value ?? '');
    const escaped = raw
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return { [field]: { $regex: new RegExp(`^${escaped}$`, p.op === 'ilike' ? 'i' : '') } };
  }
  return {};
}

/**
 * @param {string} segment — "campo=valor" sem & externos
 * @returns {Record<string, unknown> | null}
 */
function parseOneFilter(segment) {
  const eq = segment.indexOf('=');
  if (eq <= 0) return null;
  const field = segment.slice(0, eq);
  const rhs = segment.slice(eq + 1);
  const p = parseRhs(rhs, field);
  if (!p) return null;
  return condToMongo(field, p);
}

/**
 * @param {string} inner — conteúdo dentro de or=(...)
 * @returns {Record<string, unknown> | null}
 */
function parseOrFromInner(inner) {
  const segments = splitOrInner(inner);
  /** @type {Record<string, unknown>[]} */
  const conds = [];
  for (const seg of segments) {
    const dot1 = seg.indexOf('.');
    if (dot1 <= 0) continue;
    const field = seg.slice(0, dot1);
    const rest = seg.slice(dot1 + 1);
    const p = parseRhs(rest, field);
    if (p) conds.push(condToMongo(field, p));
  }
  if (conds.length === 0) return null;
  if (conds.length === 1) return conds[0];
  return { $or: conds };
}

/**
 * @param {string} inner
 * @returns {string[]}
 */
function splitOrInner(inner) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * @param {string} qs
 * @returns {{ filter: Record<string, unknown>, project: Record<string, number>|null, sort: Record<string, 1|-1>, skip: number, limit: number | null }}
 */
function parseSelectQuery(qs) {
  /** @type {Record<string, unknown>} */
  const and = [];
  let skip = 0;
  /** @type {number | null} */
  let limit = null;
  /** @type {Record<string, 1|-1>} */
  const sort = {};
  /** @type {Record<string, number>|null} */
  let project = null;

  const parts = String(qs || '')
    .split('&')
    .filter(Boolean);
  for (const raw of parts) {
    if (raw.startsWith('or=(') && raw.endsWith(')')) {
      const inner = raw.slice(4, -1);
      const orDoc = parseOrFromInner(inner);
      if (orDoc) and.push(orDoc);
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const k = raw.slice(0, eq);
    const v = raw.slice(eq + 1);
    if (k === 'select') {
      if (v === '*') project = null;
      else {
        project = {};
        v.split(',').forEach((c) => {
          const col = c.trim();
          if (col) project[col] = 1;
        });
      }
      continue;
    }
    if (k === 'limit') {
      limit = Math.min(parseInt(v, 10) || 0, 50000);
      continue;
    }
    if (k === 'offset') {
      skip = parseInt(v, 10) || 0;
      continue;
    }
    if (k === 'order') {
      v.split(',').forEach((chunk) => {
        const [col, dir] = chunk.split('.');
        if (col) sort[col.trim()] = dir === 'desc' ? -1 : 1;
      });
      continue;
    }
    const one = parseOneFilter(raw);
    if (one) and.push(one);
  }

  const filter = and.length === 0 ? {} : and.length === 1 ? and[0] : { $and: and };
  return { filter, project, sort, skip, limit };
}

/**
 * @param {unknown} doc
 * @returns {Record<string, unknown>}
 */
function stripInternal(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const o = { ...doc };
  delete o._id;
  delete o._migrated_at;
  delete o._source;
  return o;
}

/**
 * @param {unknown} data
 * @returns {unknown}
 */
function stripInternalJson(data) {
  if (Array.isArray(data)) return data.map((d) => stripInternal(d));
  return stripInternal(data);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function maskCpfInObject(row) {
  const out = { ...row };
  if (Object.prototype.hasOwnProperty.call(out, 'cpf')) {
    const val = out.cpf;
    const d = String(val ?? '').replace(/\D/g, '');
    out.cpf =
      d.length !== 11 ? (val == null || val === '' ? '' : String(val)) : `${d.slice(0, 3)}.***.***-**`;
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {unknown}
 */
function maskCpfInJson(data) {
  if (Array.isArray(data)) return data.map((r) => (r && typeof r === 'object' ? maskCpfInObject(r) : r));
  if (data && typeof data === 'object') return maskCpfInObject(data);
  return data;
}

/**
 * @param {string} onConflict
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
function conflictFilter(onConflict, doc) {
  const keys = onConflict.split(',').map((k) => k.trim());
  /** @type {Record<string, unknown>} */
  const f = {};
  for (const k of keys) {
    if (doc[k] !== undefined) f[k] = doc[k];
  }
  return f;
}

/**
 * @param {object} params
 * @param {string} params.table
 * @param {string} params.query
 * @param {string} params.method
 * @param {unknown} params.body
 * @param {string} [params.prefer]
 * @param {string} [params.range]
 * @param {boolean} [params.maskSensitive]
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executePostgrestMongo(params) {
  try {
    return await runPostgrestMongo(params);
  } catch (err) {
    if (isTopologyClosedError(err)) {
      await resetMongoClient();
      return await runPostgrestMongo(params);
    }
    throw err;
  }
}

/**
 * @param {object} params
 * @param {string} params.table
 * @param {string} params.query
 * @param {string} params.method
 * @param {unknown} params.body
 * @param {string} [params.prefer]
 * @param {string} [params.range]
 * @param {boolean} [params.maskSensitive]
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function runPostgrestMongo({
  table,
  query,
  method,
  body,
  prefer,
  range,
  maskSensitive
}) {
  const collName = collectionName(table);
  const qs = fullQueryString(table, query);
  const db = await getDb();
  const coll = db.collection(collName);
  const httpMethod = (method || 'GET').toUpperCase();
  const wantsCount = /count=exact/i.test(String(prefer || '')) && String(range || '').startsWith('0-0');

  if (httpMethod === 'GET') {
    if (wantsCount) {
      const { filter } = parseSelectQuery(qs);
      const n = await coll.countDocuments(filter);
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Range': `0-0/${n}`
        },
        body: '[]'
      };
    }
    const { filter, project, sort, skip, limit } = parseSelectQuery(qs);
    let cur = coll.find(filter);
    if (project && Object.keys(project).length) cur = cur.project(project);
    if (Object.keys(sort).length) cur = cur.sort(sort);
    cur = cur.skip(skip);
    if (limit != null && limit > 0) cur = cur.limit(limit);
    const rows = await cur.toArray();
    let data = stripInternalJson(rows);
    if (maskSensitive === true) data = maskCpfInJson(data);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  }

  if (httpMethod === 'PATCH') {
    const { filter } = parseSelectQuery(qs);
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'PATCH requer filtro na query (ex: id=eq.x)' })
      };
    }
    const patch = body && typeof body === 'object' ? { ...body } : {};
    delete patch._id;
    const minimal = /return=minimal/i.test(String(prefer || ''));
    const multi =
      filter &&
      typeof filter === 'object' &&
      Object.values(filter).some((v) => v && typeof v === 'object' && '$in' in v);
    if (multi) {
      await coll.updateMany(filter, { $set: patch });
      if (minimal) {
        return { statusCode: 204, headers: { 'Content-Type': 'application/json' }, body: '' };
      }
      const docs = await coll.find(filter).toArray();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stripInternalJson(docs))
      };
    }
    const doc = await coll.findOneAndUpdate(filter, { $set: patch }, { returnDocument: 'after' });
    if (minimal) {
      return { statusCode: 204, headers: { 'Content-Type': 'application/json' }, body: '' };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc ? [stripInternal(doc)] : [])
    };
  }

  if (httpMethod === 'DELETE') {
    const { filter } = parseSelectQuery(qs);
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'DELETE requer filtro na query' })
      };
    }
    await coll.deleteOne(filter);
    return {
      statusCode: 204,
      headers: { 'Content-Type': 'application/json' },
      body: ''
    };
  }

  if (httpMethod === 'POST') {
    const onM = qs.match(/on_conflict=([^&]+)/);
    const onConflict = onM ? dec(onM[1]) : '';
    const list = Array.isArray(body) ? body : body ? [body] : [];
    if (!list.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'body vazio' })
      };
    }
    const minimal = /return=minimal/i.test(String(prefer || ''));
    if (onConflict) {
      const ops = list.map((doc) => {
        const d = { ...doc };
        delete d._id;
        const filt = conflictFilter(onConflict, d);
        return {
          replaceOne: {
            filter: filt,
            replacement: d,
            upsert: true
          }
        };
      });
      await coll.bulkWrite(ops, { ordered: false });
    } else {
      const docs = list.map((d) => {
        const x = { ...d };
        delete x._id;
        return x;
      });
      await coll.insertMany(docs, { ordered: false });
    }
    if (minimal) {
      return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: '' };
    }
    const inserted = stripInternalJson(list);
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inserted)
    };
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: `Método Mongo não suportado: ${httpMethod}` })
  };
}

module.exports = {
  executePostgrestMongo,
  getDb,
  fullQueryString,
  parseSelectQuery
};
