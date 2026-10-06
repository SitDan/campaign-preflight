import { Redis } from "@upstash/redis";
import type { CasResult, SessionStore, Versioned } from "@/services/store";
import { isSessionDoc, type SessionDoc } from "@/services/types";

/**
 * SessionStore sur Upstash Redis (REST). Atomicité par scripts Lua :
 * la logique métier reste en TypeScript, Redis ne fait que du compare-and-set.
 * Session : HASH { v, doc } avec PEXPIREAT = échéance absolue de la session.
 */
const sessionKey = (sessionId: string) => `cp:s:${sessionId}`;
const codeKey = (codeHash: string) => `cp:c:${codeHash}`;

const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'v', '1', 'doc', ARGV[1])
redis.call('PEXPIREAT', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3], 'PXAT', ARGV[4])
return 1`;

const GET = `return redis.call('HMGET', KEYS[1], 'v', 'doc')`;

const CAS = `
local v = redis.call('HGET', KEYS[1], 'v')
if not v then return 'missing' end
if v ~= ARGV[1] then return 'conflict' end
if ARGV[4] == '1' then
  local owner = redis.call('GET', KEYS[2])
  if owner ~= ARGV[5] then return 'conflict' end
  redis.call('DEL', KEYS[2])
end
redis.call('HSET', KEYS[1], 'v', tostring(tonumber(v) + 1), 'doc', ARGV[2])
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
return 'ok'`;

const INCR = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return n`;

export function createRedisStore(config: { url: string; token: string }): SessionStore {
  const redis = new Redis({ url: config.url, token: config.token, automaticDeserialization: false, enableTelemetry: false });
  const create = redis.createScript<number>(CREATE);
  const get = redis.createScript<[string | null, string | null]>(GET);
  const cas = redis.createScript<string>(CAS);
  const incr = redis.createScript<number>(INCR);

  return {
    async create(doc, code) {
      const result = await create.exec(
        [sessionKey(doc.sessionId), codeKey(code.hash)],
        [JSON.stringify(doc), String(doc.expiresAt), doc.sessionId, String(code.expiresAt)],
      );
      return Number(result) === 1;
    },

    async get(sessionId): Promise<Versioned<SessionDoc> | null> {
      const [version, raw] = await get.exec([sessionKey(sessionId)], []);
      if (version === null || raw === null) return null;
      const doc: unknown = JSON.parse(raw);
      if (!isSessionDoc(doc) || doc.sessionId !== sessionId) throw new StoreCorruptionError();
      return { doc, version: Number(version) };
    },

    async compareAndSet(sessionId, expectedVersion, next, options): Promise<CasResult> {
      const consume = options?.consumeCodeHash;
      const result = await cas.exec(
        [sessionKey(sessionId), consume ? codeKey(consume) : sessionKey(sessionId)],
        [String(expectedVersion), JSON.stringify(next), String(next.expiresAt), consume ? "1" : "0", sessionId],
      );
      return result === "ok" || result === "conflict" || result === "missing" ? result : "conflict";
    },

    async findSessionIdByCode(codeHash) {
      const value = await redis.get<string>(codeKey(codeHash));
      return typeof value === "string" ? value : null;
    },

    async delete(sessionId, codeHash) {
      if (codeHash) await redis.del(sessionKey(sessionId), codeKey(codeHash));
      else await redis.del(sessionKey(sessionId));
    },

    async increment(key, ttlMs) {
      return Number(await incr.exec([`cp:rl:${key}`], [String(ttlMs)]));
    },
  };
}

export class StoreCorruptionError extends Error {
  readonly code = "store_corrupted";
}
