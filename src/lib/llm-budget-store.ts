/**
 * Storage for the shared LLM guards (#71, #327): a per-provider token bucket
 * with per-class protected reserves, a per-provider circuit breaker with
 * tier-fair half-open probing, and per-purpose-class daily token/cost budgets
 * (guaranteed shares, hard caps, borrowing) with reservations.
 *
 * `RedisGuardStore` runs each decision as one atomic Lua script. Time comes
 * from Redis `TIME` inside the script (never Node's clock), so instances with
 * skewed clocks agree on bucket refill, breaker expiry and the UTC budget day.
 * `MemoryGuardStore` is a line-for-line JS reference of the same logic with an
 * injectable clock; tests run one table of scenarios against both.
 *
 * Admission arithmetic (identical in ACQUIRE_LUA and MemoryGuardStore, #327):
 *
 *   With daily budget B (tokens or costBudgetMicros), class c, estimate est:
 *     u_d      = used_d + reserved_d                  for each class d
 *     U        = total_used + total_reserved
 *     g_d      = math.floor(B * guaranteePct_d / 100) for each class d
 *     G        = sum_d g_d
 *     cap_c    = math.floor(B * capPct_c / 100)
 *     heldBack = sum_{d != c} max(0, g_d - u_d)       (unused guarantees of other classes)
 *
 *   1. If u_c + est > cap_c:
 *        reject BUDGET_EXCEEDED (reason = 'CLASS_CAP')
 *   2. Else if u_c + est <= g_c and U + est <= B:
 *        admit (within class guarantee)
 *   3. Else if canBorrow_c and U + est <= B - heldBack:
 *        admit (borrowing never eats another class's unused guarantee)
 *   4. Else if not canBorrow_c and g_c == 0 and U + est <= B - G and U + est <= B - heldBack:
 *        admit (unguaranteed class within cap_c drawing from the unallocated pool B - G)
 *   5. Else:
 *        reject BUDGET_EXCEEDED (reason = canBorrow_c ? 'RESERVED_FOR_GUARANTEES' : 'BORROW_DENIED')
 *
 *   The same checks apply to cost micros (with est_cost = 1 micro at acquire
 *   time so a class at or above its cost cap / borrow limit is refused).
 *
 * Key layout (all under `<prefix>:`):
 *   breaker:<provider>   hash  state, openedUntil, failures, probeHolder, probeUntil, probeClass, probeHolder2, probeUntil2
 *   bucket:<provider>    hash  tokens, ts
 *   budget:<yyyy-mm-dd>  hash  tokens, costMicros, reserved, t:<class>, c:<class>, r:<class>   (48 h TTL)
 *   leases               zset  member "<leaseId>|<day>|<estimate>|<class>", score = expiry ms
 */
import type Redis from 'ioredis';

export type Provider = 'anthropic' | 'gemini' | 'openai';
export type Priority = 'cron' | 'admin';
export type PurposeClass = 'dispute' | 'admin' | 'generation' | 'forecast' | 'hedge' | 'other';
export const PURPOSE_CLASSES: readonly PurposeClass[] = [
  'dispute',
  'admin',
  'generation',
  'forecast',
  'hedge',
  'other',
];

export interface ClassPolicy {
  guaranteePct: number;
  capPct: number;
  canBorrow: boolean;
  bucketReserve: number;
}

export type ClassPolicyMap = Record<PurposeClass, ClassPolicy>;

export const DEFAULT_CLASS_POLICY: ClassPolicyMap = {
  dispute: { guaranteePct: 15, capPct: 40, canBorrow: true, bucketReserve: 2 },
  admin: { guaranteePct: 10, capPct: 100, canBorrow: true, bucketReserve: 1 },
  generation: { guaranteePct: 20, capPct: 50, canBorrow: true, bucketReserve: 0 },
  forecast: { guaranteePct: 20, capPct: 50, canBorrow: true, bucketReserve: 0 },
  hedge: { guaranteePct: 5, capPct: 20, canBorrow: true, bucketReserve: 0 },
  other: { guaranteePct: 0, capPct: 10, canBorrow: false, bucketReserve: 0 },
};

export type BreakerState = 'closed' | 'open' | 'half-open';
export type CallOutcome = 'ok' | 'error' | 'quota';
export type BudgetRejectReason = 'CLASS_CAP' | 'RESERVED_FOR_GUARANTEES' | 'BORROW_DENIED';

export interface AcquireParams {
  provider: Provider;
  leaseId: string;
  priority: Priority;
  purposeClass?: PurposeClass;
  classPolicy?: ClassPolicyMap;
  /** Tokens to reserve (input estimate + max output). */
  estimate: number;
  rpm: number;
  tokenBudget: number;
  costBudgetMicros: number;
  reservePct: number;
  /** How long a reservation lives if never recorded. */
  leaseTtlMs: number;
  /** How long a half-open probe may hold the breaker. */
  probeTtlMs: number;
}

export type AcquireResult =
  | { ok: true; day: string; probe: boolean }
  | {
      ok: false;
      reason: 'CIRCUIT_OPEN' | 'RATE_LIMITED' | 'BUDGET_EXCEEDED';
      retryAfterMs: number;
      purposeClass?: PurposeClass;
      budgetReason?: BudgetRejectReason;
    };

export interface RecordParams {
  provider: Provider;
  leaseId: string;
  day: string;
  estimate: number;
  purposeClass?: PurposeClass;
  probe: boolean;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  outcome: CallOutcome;
  failureThreshold: number;
  /** Breaker open time for failures and for quotas with no provider hint. */
  openMs: number;
  /** For quotas: hold the breaker at least until the next UTC midnight. */
  openUntilMidnight: boolean;
}

export interface ClassUsage {
  tokens: number;
  costMicros: number;
  reserved: number;
}

export interface UsageSnapshot {
  day: string;
  tokens: number;
  costMicros: number;
  reserved: number;
  byClass: Record<PurposeClass, ClassUsage>;
  breakers: Record<Provider, { state: BreakerState; openedUntil: number | null }>;
}

export interface LlmGuardStore {
  acquire(p: AcquireParams): Promise<AcquireResult>;
  record(p: RecordParams): Promise<void>;
  breakerState(provider: Provider): Promise<BreakerState>;
  usage(): Promise<UsageSnapshot>;
  /** SET NX with a TTL; true when this caller created the key. */
  setOnce(key: string, ttlSeconds: number): Promise<boolean>;
}

const DAY_MS = 86_400_000;
const providers: Provider[] = ['anthropic', 'gemini', 'openai'];

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolves the effective class and policy map for an `AcquireParams` call.
 * When `classPolicy` is omitted (e.g. legacy low-level store tests that only
 * pass `priority` and `reservePct`), synthesizes a 2-tier policy from
 * `reservePct` so the same class admission logic evaluates both.
 */
export function resolveAcquirePolicy(p: AcquireParams): {
  cls: PurposeClass;
  policy: ClassPolicyMap;
  bucketThreshold: number;
} {
  let cls: PurposeClass;
  let policy: ClassPolicyMap;

  if (p.classPolicy) {
    cls = p.purposeClass ?? (p.priority === 'admin' ? 'admin' : 'other');
    policy = p.classPolicy;
  } else if (p.purposeClass) {
    cls = p.purposeClass;
    policy = {
      ...DEFAULT_CLASS_POLICY,
      admin: { ...DEFAULT_CLASS_POLICY.admin, guaranteePct: p.reservePct },
    };
  } else {
    cls = p.priority === 'admin' ? 'admin' : 'other';
    const cronCap = Math.max(0, 100 - p.reservePct);
    policy = {
      dispute: { guaranteePct: 0, capPct: cronCap, canBorrow: true, bucketReserve: 0 },
      admin: { guaranteePct: p.reservePct, capPct: 100, canBorrow: true, bucketReserve: 0 },
      generation: { guaranteePct: 0, capPct: cronCap, canBorrow: true, bucketReserve: 0 },
      forecast: { guaranteePct: 0, capPct: cronCap, canBorrow: true, bucketReserve: 0 },
      hedge: { guaranteePct: 0, capPct: cronCap, canBorrow: true, bucketReserve: 0 },
      other: { guaranteePct: 0, capPct: cronCap, canBorrow: true, bucketReserve: 0 },
    };
  }

  let maxReserve = 0;
  for (const c of PURPOSE_CLASSES) {
    if (policy[c].bucketReserve > maxReserve) maxReserve = policy[c].bucketReserve;
  }
  const classReserve = policy[cls].bucketReserve;
  const bucketThreshold = classReserve > 0 ? 1 : 1 + maxReserve;

  return { cls, policy, bucketThreshold };
}

/** Pure JS reference of the class admission rule (matches ACQUIRE_LUA). */
export function checkClassAdmission(
  budget: number,
  cls: PurposeClass,
  est: number,
  usedByClass: Record<PurposeClass, number>,
  totalUsed: number,
  policy: ClassPolicyMap,
): { ok: true } | { ok: false; reason: BudgetRejectReason } {
  const pol = policy[cls];
  const u_c = usedByClass[cls] ?? 0;
  const g_c = Math.floor((budget * pol.guaranteePct) / 100);
  const cap_c = Math.floor((budget * pol.capPct) / 100);

  if (u_c + est > cap_c) {
    return { ok: false, reason: 'CLASS_CAP' };
  }
  if (u_c + est <= g_c && totalUsed + est <= budget) {
    return { ok: true };
  }

  let heldBack = 0;
  let totalGuarantees = 0;
  for (const d of PURPOSE_CLASSES) {
    const g_d = Math.floor((budget * policy[d].guaranteePct) / 100);
    totalGuarantees += g_d;
    if (d !== cls) {
      const rem = g_d - (usedByClass[d] ?? 0);
      if (rem > 0) heldBack += rem;
    }
  }

  if (pol.canBorrow && totalUsed + est <= budget - heldBack) {
    return { ok: true };
  }
  if (!pol.canBorrow && g_c === 0 && totalUsed + est <= budget - totalGuarantees && totalUsed + est <= budget - heldBack) {
    return { ok: true };
  }

  return { ok: false, reason: pol.canBorrow ? 'RESERVED_FOR_GUARANTEES' : 'BORROW_DENIED' };
}

// ─── Lua ──────────────────────────────────────────────────────────────────────

const LUA_PRELUDE = `
local t = redis.call('TIME')
local secs = tonumber(t[1])
local now = secs * 1000 + math.floor(tonumber(t[2]) / 1000)
local function civil(sec)
  local z = math.floor(sec / 86400) + 719468
  local era = math.floor(z / 146097)
  local doe = z - era * 146097
  local yoe = math.floor((doe - math.floor(doe / 1460) + math.floor(doe / 36524) - math.floor(doe / 146096)) / 365)
  local y = yoe + era * 400
  local doy = doe - (365 * yoe + math.floor(yoe / 4) - math.floor(yoe / 100))
  local mp = math.floor((5 * doy + 2) / 153)
  local d = doy - math.floor((153 * mp + 2) / 5) + 1
  local m = mp < 10 and mp + 3 or mp - 9
  if m <= 2 then y = y + 1 end
  return string.format('%04d-%02d-%02d', y, m, d)
end
local function msToMidnight() return (86400 - (secs % 86400)) * 1000 end
local CLASSES = {'dispute', 'admin', 'generation', 'forecast', 'hedge', 'other'}
`;

/**
 * KEYS: [1] breaker, [2] bucket, [3] leases
 * ARGV: 1 leaseId, 2 purposeClass, 3 estimate, 4 rpm, 5 tokenBudget, 6 costBudgetMicros,
 *       7 leaseTtlMs, 8 probeTtlMs, 9 prefix, 10 canBorrow ('1'|'0'), 11 capPct,
 *       12 bucketThreshold, 13..18 guaranteePct for CLASSES[1..6]
 * Returns {'OK', day, probe} or {reason, retryAfterMs, purposeClass?, budgetReason?}.
 */
export const ACQUIRE_LUA = `${LUA_PRELUDE}
local day = civil(secs)
local cls = ARGV[2]
local prefix = ARGV[9]
local budgetKey = prefix .. ':budget:' .. day

-- 0. reclaim reservations whose lease expired without a record() (crash/hang)
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, member in ipairs(expired) do
  local _, d, est, mcls = string.match(member, '^(.-)|(.-)|(%d+)|(.+)$')
  if not d then
    _, d, est = string.match(member, '^(.-)|(.-)|(%d+)$')
    mcls = 'other'
  end
  if d then
    local bk = prefix .. ':budget:' .. d
    local estNum = tonumber(est)
    local r = tonumber(redis.call('HGET', bk, 'reserved') or '0') - estNum
    if r < 0 then r = 0 end
    local rc = tonumber(redis.call('HGET', bk, 'r:' .. mcls) or '0') - estNum
    if rc < 0 then rc = 0 end
    redis.call('HSET', bk, 'reserved', r, 'r:' .. mcls, rc)
  end
  redis.call('ZREM', KEYS[3], member)
end

-- a. breaker (with secondary probe slot for dispute when primary is held by a routine class)
local b = redis.call('HMGET', KEYS[1], 'state', 'openedUntil', 'probeUntil', 'probeClass', 'probeHolder2', 'probeUntil2')
local state = b[1] or 'closed'
local probeSlot = 0
if state == 'open' then
  local openedUntil = tonumber(b[2] or '0')
  if now < openedUntil then return {'CIRCUIT_OPEN', openedUntil - now} end
  probeSlot = 1
elseif state == 'half-open' then
  local probeUntil = tonumber(b[3] or '0')
  local probeClass = b[4] or ''
  local probeHolder2 = b[5] or ''
  local probeUntil2 = tonumber(b[6] or '0')
  if now >= probeUntil then
    probeSlot = 1
  elseif cls == 'dispute' and probeClass ~= 'dispute' then
    if probeHolder2 == '' or now >= probeUntil2 then
      probeSlot = 2
    else
      local waitUntil = probeUntil < probeUntil2 and probeUntil or probeUntil2
      return {'CIRCUIT_OPEN', math.max(1, waitUntil - now)}
    end
  else
    return {'CIRCUIT_OPEN', probeUntil - now}
  end
end

-- b. token bucket (capacity = rpm, refilled at rpm/60000 per ms, with protected slice)
local rpm = tonumber(ARGV[4])
local threshold = tonumber(ARGV[12])
local bk = redis.call('HMGET', KEYS[2], 'tokens', 'ts')
local tokens = tonumber(bk[1])
local ts = tonumber(bk[2])
if not tokens then tokens = rpm; ts = now end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(rpm, tokens + elapsed * rpm / 60000)
if tokens < threshold then
  return {'RATE_LIMITED', math.ceil((threshold - tokens) * 60000 / rpm)}
end

-- c. daily per-class & total budget admission
local est = tonumber(ARGV[3])
local tokenBudget = tonumber(ARGV[5])
local costBudget = tonumber(ARGV[6])
local canBorrow = ARGV[10] == '1'
local capPct = tonumber(ARGV[11])

local totVals = redis.call('HMGET', budgetKey, 'tokens', 'costMicros', 'reserved')
local totalTokens = tonumber(totVals[1] or '0') + tonumber(totVals[3] or '0')
local totalCost = tonumber(totVals[2] or '0')

local uTokens = {}
local uCosts = {}
local gPct = {}
for i, cName in ipairs(CLASSES) do
  local cVals = redis.call('HMGET', budgetKey, 't:' .. cName, 'r:' .. cName, 'c:' .. cName)
  uTokens[cName] = tonumber(cVals[1] or '0') + tonumber(cVals[2] or '0')
  uCosts[cName] = tonumber(cVals[3] or '0')
  gPct[cName] = tonumber(ARGV[12 + i] or '0')
end

local function checkAdmit(B, uMap, U, itemEst)
  local u_c = uMap[cls] or 0
  local g_c = math.floor(B * (gPct[cls] or 0) / 100)
  local cap_c = math.floor(B * capPct / 100)
  if u_c + itemEst > cap_c then
    return false, 'CLASS_CAP'
  end
  if u_c + itemEst <= g_c and U + itemEst <= B then
    return true, ''
  end
  local heldBack = 0
  local totalG = 0
  for _, d in ipairs(CLASSES) do
    local g_d = math.floor(B * (gPct[d] or 0) / 100)
    totalG = totalG + g_d
    if d ~= cls then
      local rem = g_d - (uMap[d] or 0)
      if rem > 0 then heldBack = heldBack + rem end
    end
  end
  if canBorrow and U + itemEst <= B - heldBack then
    return true, ''
  end
  if not canBorrow and g_c == 0 and U + itemEst <= B - totalG and U + itemEst <= B - heldBack then
    return true, ''
  end
  return false, canBorrow and 'RESERVED_FOR_GUARANTEES' or 'BORROW_DENIED'
end

local okTok, reasonTok = checkAdmit(tokenBudget, uTokens, totalTokens, est)
if not okTok then
  return {'BUDGET_EXCEEDED', msToMidnight(), cls, reasonTok}
end

local okCost, reasonCost = checkAdmit(costBudget, uCosts, totalCost, 1)
if not okCost then
  return {'BUDGET_EXCEEDED', msToMidnight(), cls, reasonCost}
end

-- commit
redis.call('HSET', KEYS[2], 'tokens', tokens - 1, 'ts', now)
redis.call('PEXPIRE', KEYS[2], 3600000)
redis.call('HINCRBY', budgetKey, 'reserved', est)
redis.call('HINCRBY', budgetKey, 'r:' .. cls, est)
redis.call('EXPIRE', budgetKey, 172800)
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[7]), ARGV[1] .. '|' .. day .. '|' .. ARGV[3] .. '|' .. cls)
local probe = 0
if probeSlot == 1 then
  redis.call('HSET', KEYS[1], 'state', 'half-open', 'probeHolder', ARGV[1], 'probeUntil', now + tonumber(ARGV[8]), 'probeClass', cls)
  probe = 1
elseif probeSlot == 2 then
  redis.call('HSET', KEYS[1], 'state', 'half-open', 'probeHolder2', ARGV[1], 'probeUntil2', now + tonumber(ARGV[8]))
  probe = 1
end
return {'OK', day, probe}
`;

/**
 * KEYS: [1] breaker, [2] leases
 * ARGV: 1 leaseId, 2 day, 3 estimate, 4 probe, 5 inputTokens, 6 outputTokens, 7 costMicros,
 *       8 outcome, 9 failureThreshold, 10 openMs, 11 openUntilMidnight, 12 prefix, 13 purposeClass
 */
export const RECORD_LUA = `${LUA_PRELUDE}
local prefix = ARGV[12]
local cls = ARGV[13] or 'other'
local bk = prefix .. ':budget:' .. ARGV[2]
local member4 = ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3] .. '|' .. cls
local member3 = ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3]

-- release the reservation (unless acquire already reclaimed it)
local removed = redis.call('ZREM', KEYS[2], member4)
if removed == 0 then
  removed = redis.call('ZREM', KEYS[2], member3)
end
if removed == 1 then
  local estNum = tonumber(ARGV[3])
  local r = tonumber(redis.call('HGET', bk, 'reserved') or '0') - estNum
  if r < 0 then r = 0 end
  local rc = tonumber(redis.call('HGET', bk, 'r:' .. cls) or '0') - estNum
  if rc < 0 then rc = 0 end
  redis.call('HSET', bk, 'reserved', r, 'r:' .. cls, rc)
end
local total = tonumber(ARGV[5]) + tonumber(ARGV[6])
if total > 0 then
  redis.call('HINCRBY', bk, 'tokens', total)
  redis.call('HINCRBY', bk, 't:' .. cls, total)
end
local costNum = tonumber(ARGV[7])
if costNum > 0 then
  redis.call('HINCRBY', bk, 'costMicros', costNum)
  redis.call('HINCRBY', bk, 'c:' .. cls, costNum)
end
redis.call('EXPIRE', bk, 172800)

local b = redis.call('HMGET', KEYS[1], 'state', 'failures', 'probeHolder', 'probeHolder2')
local state = b[1] or 'closed'
local failures = tonumber(b[2] or '0')
local holder = b[3]
local holder2 = b[4]
local outcome = ARGV[8]
local openMs = tonumber(ARGV[10])

local function open(ms)
  redis.call('HSET', KEYS[1], 'state', 'open', 'openedUntil', now + ms, 'failures', 0)
  redis.call('HDEL', KEYS[1], 'probeHolder', 'probeUntil', 'probeClass', 'probeHolder2', 'probeUntil2')
end

if outcome == 'ok' then
  if state == 'half-open' then
    if holder == ARGV[1] or holder2 == ARGV[1] then
      redis.call('HSET', KEYS[1], 'state', 'closed', 'failures', 0)
      redis.call('HDEL', KEYS[1], 'probeHolder', 'probeUntil', 'probeClass', 'probeHolder2', 'probeUntil2', 'openedUntil')
    end
  elseif state == 'closed' and failures > 0 then
    redis.call('HSET', KEYS[1], 'failures', 0)
  end
elseif outcome == 'quota' then
  if ARGV[11] == '1' then
    local m = msToMidnight()
    if m > openMs then openMs = m end
  end
  open(openMs)
else
  if state == 'half-open' then
    if holder == ARGV[1] or holder2 == ARGV[1] then open(openMs) end
  elseif state == 'closed' then
    failures = failures + 1
    if failures >= tonumber(ARGV[9]) then open(openMs)
    else redis.call('HSET', KEYS[1], 'failures', failures) end
  end
end
return 1
`;

// ─── Redis ────────────────────────────────────────────────────────────────────

export class RedisGuardStore implements LlmGuardStore {
  private defined = new WeakSet<Redis>();

  constructor(private readonly redis: () => Redis, private readonly prefix = 'llm') {}

  private client(): any {
    const r = this.redis();
    if (!this.defined.has(r)) {
      // defineCommand uses EVALSHA and falls back to EVAL after SCRIPT FLUSH.
      r.defineCommand('llmAcquire', { numberOfKeys: 3, lua: ACQUIRE_LUA });
      r.defineCommand('llmRecord', { numberOfKeys: 2, lua: RECORD_LUA });
      this.defined.add(r);
    }
    return r;
  }

  private key(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  async acquire(p: AcquireParams): Promise<AcquireResult> {
    const { cls, policy, bucketThreshold } = resolveAcquirePolicy(p);
    const pol = policy[cls];
    const res: Array<string | number> = await this.client().llmAcquire(
      this.key('breaker', p.provider),
      this.key('bucket', p.provider),
      this.key('leases'),
      p.leaseId,
      cls,
      p.estimate,
      p.rpm,
      p.tokenBudget,
      p.costBudgetMicros,
      p.leaseTtlMs,
      p.probeTtlMs,
      this.prefix,
      pol.canBorrow ? '1' : '0',
      pol.capPct,
      bucketThreshold,
      ...PURPOSE_CLASSES.map((c) => policy[c].guaranteePct),
    );
    if (res[0] === 'OK') return { ok: true, day: String(res[1]), probe: Number(res[2]) === 1 };
    const reason = res[0] as 'CIRCUIT_OPEN' | 'RATE_LIMITED' | 'BUDGET_EXCEEDED';
    if (reason === 'BUDGET_EXCEEDED') {
      return {
        ok: false,
        reason,
        retryAfterMs: Number(res[1]),
        purposeClass: (res[2] as PurposeClass | undefined) ?? cls,
        budgetReason: (res[3] as BudgetRejectReason | undefined) ?? 'CLASS_CAP',
      };
    }
    return { ok: false, reason, retryAfterMs: Number(res[1]) };
  }

  async record(p: RecordParams): Promise<void> {
    const cls = p.purposeClass ?? 'other';
    await this.client().llmRecord(
      this.key('breaker', p.provider),
      this.key('leases'),
      p.leaseId,
      p.day,
      p.estimate,
      p.probe ? 1 : 0,
      p.inputTokens,
      p.outputTokens,
      p.costMicros,
      p.outcome,
      p.failureThreshold,
      p.openMs,
      p.openUntilMidnight ? 1 : 0,
      this.prefix,
      cls,
    );
  }

  private async serverNowMs(): Promise<number> {
    const [s, us] = await this.redis().time();
    return Number(s) * 1000 + Math.floor(Number(us) / 1000);
  }

  private async readBreaker(provider: Provider, now: number) {
    const [state, openedUntil] = await this.redis().hmget(this.key('breaker', provider), 'state', 'openedUntil');
    const until = openedUntil ? Number(openedUntil) : null;
    let s = (state as BreakerState | null) ?? 'closed';
    // An expired open breaker admits one probe on the next call.
    if (s === 'open' && until !== null && now >= until) s = 'half-open';
    return { state: s, openedUntil: until };
  }

  async breakerState(provider: Provider): Promise<BreakerState> {
    return (await this.readBreaker(provider, await this.serverNowMs())).state;
  }

  async usage(): Promise<UsageSnapshot> {
    const now = await this.serverNowMs();
    const day = utcDay(now);
    const fields = [
      'tokens',
      'costMicros',
      'reserved',
      ...PURPOSE_CLASSES.flatMap((c) => [`t:${c}`, `c:${c}`, `r:${c}`]),
    ];
    const vals = await this.redis().hmget(this.key('budget', day), ...fields);
    const byClass = {} as Record<PurposeClass, ClassUsage>;
    for (let i = 0; i < PURPOSE_CLASSES.length; i++) {
      const c = PURPOSE_CLASSES[i];
      const baseIdx = 3 + i * 3;
      byClass[c] = {
        tokens: Number(vals[baseIdx] ?? 0),
        costMicros: Number(vals[baseIdx + 1] ?? 0),
        reserved: Number(vals[baseIdx + 2] ?? 0),
      };
    }
    const breakers = {} as UsageSnapshot['breakers'];
    for (const p of PROVIDERS) breakers[p] = await this.readBreaker(p, now);
    return {
      day,
      tokens: Number(vals[0] ?? 0),
      costMicros: Number(vals[1] ?? 0),
      reserved: Number(vals[2] ?? 0),
      byClass,
      breakers,
    };
  }

  async setOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis().set(this.key('once', key), '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }
}

// ─── Memory reference implementation ──────────────────────────────────────────

interface MemBreaker {
  state: BreakerState;
  openedUntil: number;
  failures: number;
  probeHolder?: string;
  probeUntil: number;
  probeClass?: PurposeClass;
  probeHolder2?: string;
  probeUntil2: number;
}

interface MemBudget {
  tokens: number;
  costMicros: number;
  reserved: number;
  byClass: Record<PurposeClass, ClassUsage>;
}

function emptyByClass(): Record<PurposeClass, ClassUsage> {
  return {
    dispute: { tokens: 0, costMicros: 0, reserved: 0 },
    admin: { tokens: 0, costMicros: 0, reserved: 0 },
    generation: { tokens: 0, costMicros: 0, reserved: 0 },
    forecast: { tokens: 0, costMicros: 0, reserved: 0 },
    hedge: { tokens: 0, costMicros: 0, reserved: 0 },
    other: { tokens: 0, costMicros: 0, reserved: 0 },
  };
}

export class MemoryGuardStore implements LlmGuardStore {
  private breakers = new Map<Provider, MemBreaker>();
  private buckets = new Map<Provider, { tokens: number; ts: number }>();
  private budgets = new Map<string, MemBudget>();
  private leases = new Map<string, number>(); // member -> expiry
  private once = new Map<string, number>();

  constructor(public clock: () => number = Date.now) {}

  private budget(day: string): MemBudget {
    let b = this.budgets.get(day);
    if (!b) {
      b = { tokens: 0, costMicros: 0, reserved: 0, byClass: emptyByClass() };
      this.budgets.set(day, b);
    }
    return b;
  }

  private breaker(provider: Provider): MemBreaker {
    let b = this.breakers.get(provider);
    if (!b) {
      b = { state: 'closed', openedUntil: 0, failures: 0, probeUntil: 0, probeUntil2: 0 };
      this.breakers.set(provider, b);
    }
    return b;
  }

  private msToMidnight(now: number): number {
    return DAY_MS - (now % DAY_MS);
  }

  async acquire(p: AcquireParams): Promise<AcquireResult> {
    const now = this.clock();
    const day = utcDay(now);
    const { cls, policy, bucketThreshold } = resolveAcquirePolicy(p);

    for (const [member, expiry] of [...this.leases]) {
      if (expiry > now) continue;
      const parts = member.split('|');
      const d = parts[1];
      const est = Number(parts[2] ?? 0);
      const mcls = ((parts[3] as PurposeClass | undefined) ?? 'other');
      const b = this.budget(d);
      b.reserved = Math.max(0, b.reserved - est);
      if (b.byClass[mcls]) {
        b.byClass[mcls].reserved = Math.max(0, b.byClass[mcls].reserved - est);
      }
      this.leases.delete(member);
    }

    const br = this.breaker(p.provider);
    let probeSlot: 0 | 1 | 2 = 0;
    if (br.state === 'open') {
      if (now < br.openedUntil) return { ok: false, reason: 'CIRCUIT_OPEN', retryAfterMs: br.openedUntil - now };
      probeSlot = 1;
    } else if (br.state === 'half-open') {
      if (now >= br.probeUntil) {
        probeSlot = 1;
      } else if (cls === 'dispute' && br.probeClass !== 'dispute') {
        if (!br.probeHolder2 || now >= br.probeUntil2) {
          probeSlot = 2;
        } else {
          const waitUntil = Math.min(br.probeUntil, br.probeUntil2);
          return { ok: false, reason: 'CIRCUIT_OPEN', retryAfterMs: Math.max(1, waitUntil - now) };
        }
      } else {
        return { ok: false, reason: 'CIRCUIT_OPEN', retryAfterMs: br.probeUntil - now };
      }
    }

    const bucket = this.buckets.get(p.provider) ?? { tokens: p.rpm, ts: now };
    const tokens = Math.min(p.rpm, bucket.tokens + (Math.max(0, now - bucket.ts) * p.rpm) / 60_000);
    if (tokens < bucketThreshold) {
      return {
        ok: false,
        reason: 'RATE_LIMITED',
        retryAfterMs: Math.ceil(((bucketThreshold - tokens) * 60_000) / p.rpm),
      };
    }

    const bud = this.budget(day);
    const usedTokensByClass = {} as Record<PurposeClass, number>;
    const usedCostByClass = {} as Record<PurposeClass, number>;
    for (const c of PURPOSE_CLASSES) {
      usedTokensByClass[c] = bud.byClass[c].tokens + bud.byClass[c].reserved;
      usedCostByClass[c] = bud.byClass[c].costMicros;
    }

    const tokAdmit = checkClassAdmission(
      p.tokenBudget,
      cls,
      p.estimate,
      usedTokensByClass,
      bud.tokens + bud.reserved,
      policy,
    );
    if (!tokAdmit.ok) {
      return {
        ok: false,
        reason: 'BUDGET_EXCEEDED',
        retryAfterMs: this.msToMidnight(now),
        purposeClass: cls,
        budgetReason: tokAdmit.reason,
      };
    }

    const costAdmit = checkClassAdmission(
      p.costBudgetMicros,
      cls,
      1,
      usedCostByClass,
      bud.costMicros,
      policy,
    );
    if (!costAdmit.ok) {
      return {
        ok: false,
        reason: 'BUDGET_EXCEEDED',
        retryAfterMs: this.msToMidnight(now),
        purposeClass: cls,
        budgetReason: costAdmit.reason,
      };
    }

    this.buckets.set(p.provider, { tokens: tokens - 1, ts: now });
    bud.reserved += p.estimate;
    bud.byClass[cls].reserved += p.estimate;
    this.leases.set(`${p.leaseId}|${day}|${p.estimate}|${cls}`, now + p.leaseTtlMs);
    if (probeSlot === 1) {
      br.state = 'half-open';
      br.probeHolder = p.leaseId;
      br.probeUntil = now + p.probeTtlMs;
      br.probeClass = cls;
    } else if (probeSlot === 2) {
      br.state = 'half-open';
      br.probeHolder2 = p.leaseId;
      br.probeUntil2 = now + p.probeTtlMs;
    }
    return { ok: true, day, probe: probeSlot !== 0 };
  }

  async record(p: RecordParams): Promise<void> {
    const now = this.clock();
    const cls = p.purposeClass ?? 'other';
    const bud = this.budget(p.day);
    const member4 = `${p.leaseId}|${p.day}|${p.estimate}|${cls}`;
    const member3 = `${p.leaseId}|${p.day}|${p.estimate}`;
    let removed = this.leases.delete(member4);
    if (!removed) {
      removed = this.leases.delete(member3);
      if (!removed) {
        for (const k of this.leases.keys()) {
          if (k.startsWith(`${member3}|`)) {
            this.leases.delete(k);
            removed = true;
            break;
          }
        }
      }
    }
    if (removed) {
      bud.reserved = Math.max(0, bud.reserved - p.estimate);
      bud.byClass[cls].reserved = Math.max(0, bud.byClass[cls].reserved - p.estimate);
    }
    const addedTokens = p.inputTokens + p.outputTokens;
    bud.tokens += addedTokens;
    bud.byClass[cls].tokens += addedTokens;
    bud.costMicros += p.costMicros;
    bud.byClass[cls].costMicros += p.costMicros;

    const br = this.breaker(p.provider);
    const open = (ms: number) => {
      br.state = 'open';
      br.openedUntil = now + ms;
      br.failures = 0;
      br.probeHolder = undefined;
      br.probeUntil = 0;
      br.probeClass = undefined;
      br.probeHolder2 = undefined;
      br.probeUntil2 = 0;
    };
    if (p.outcome === 'ok') {
      if (br.state === 'half-open') {
        if (br.probeHolder === p.leaseId || br.probeHolder2 === p.leaseId) {
          br.state = 'closed';
          br.failures = 0;
          br.probeHolder = undefined;
          br.probeUntil = 0;
          br.probeClass = undefined;
          br.probeHolder2 = undefined;
          br.probeUntil2 = 0;
          br.openedUntil = 0;
        }
      } else if (br.state === 'closed') {
        br.failures = 0;
      }
    } else if (p.outcome === 'quota') {
      open(p.openUntilMidnight ? Math.max(p.openMs, this.msToMidnight(now)) : p.openMs);
    } else if (br.state === 'half-open') {
      if (br.probeHolder === p.leaseId || br.probeHolder2 === p.leaseId) open(p.openMs);
    } else if (br.state === 'closed') {
      br.failures += 1;
      if (br.failures >= p.failureThreshold) open(p.openMs);
    }
  }

  private effective(provider: Provider, now: number) {
    const br = this.breaker(provider);
    const state: BreakerState = br.state === 'open' && now >= br.openedUntil ? 'half-open' : br.state;
    return { state, openedUntil: br.openedUntil || null };
  }

  async breakerState(provider: Provider): Promise<BreakerState> {
    return this.effective(provider, this.clock()).state;
  }

  async usage(): Promise<UsageSnapshot> {
    const now = this.clock();
    const day = utcDay(now);
    const b = this.budget(day);
    const byClass = {} as Record<PurposeClass, ClassUsage>;
    for (const c of PURPOSE_CLASSES) {
      byClass[c] = { ...b.byClass[c] };
    }
    return {
      day,
      tokens: b.tokens,
      costMicros: b.costMicros,
      reserved: b.reserved,
      breakers: {
        anthropic: this.effective('anthropic', now),
        gemini: this.effective('gemini', now),
        openai: this.effective('openai', now),
      },
    };
  }

  async setOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const now = this.clock();
    const expiry = this.once.get(key);
    if (expiry !== undefined && expiry > now) return false;
    this.once.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
