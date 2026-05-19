
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model User
 * Registered subscribers who pay for reasoning traces
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model Market
 * AI-generated prediction markets deployed on Arc
 */
export type Market = $Result.DefaultSelection<Prisma.$MarketPayload>
/**
 * Model Trade
 * Individual trade executed by the Trader Agent
 */
export type Trade = $Result.DefaultSelection<Prisma.$TradePayload>
/**
 * Model Position
 * Tracks the open/closed lifecycle of an agent position
 */
export type Position = $Result.DefaultSelection<Prisma.$PositionPayload>
/**
 * Model ReasoningTrace
 * Structured AI reasoning trace for every decision
 */
export type ReasoningTrace = $Result.DefaultSelection<Prisma.$ReasoningTracePayload>
/**
 * Model CopyTrade
 * A subscriber copying an agent's trade
 */
export type CopyTrade = $Result.DefaultSelection<Prisma.$CopyTradePayload>
/**
 * Model Subscription
 * Nanopayment subscription for trace access
 */
export type Subscription = $Result.DefaultSelection<Prisma.$SubscriptionPayload>
/**
 * Model AgentLog
 * Full audit trail of every agent decision and action
 */
export type AgentLog = $Result.DefaultSelection<Prisma.$AgentLogPayload>
/**
 * Model SignalCache
 * Cached raw signal payloads from ingestion APIs
 */
export type SignalCache = $Result.DefaultSelection<Prisma.$SignalCachePayload>
/**
 * Model BlockIndex
 * Tracks last processed block per chain for the event indexer
 */
export type BlockIndex = $Result.DefaultSelection<Prisma.$BlockIndexPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const MarketStatus: {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  RESOLVING: 'RESOLVING',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED'
};

export type MarketStatus = (typeof MarketStatus)[keyof typeof MarketStatus]


export const MarketCategory: {
  FED: 'FED',
  ECB: 'ECB',
  ELECTION: 'ELECTION',
  GEOPOLITICAL: 'GEOPOLITICAL',
  CRYPTO: 'CRYPTO',
  MACRO: 'MACRO'
};

export type MarketCategory = (typeof MarketCategory)[keyof typeof MarketCategory]


export const SettlementCurrency: {
  USDC: 'USDC',
  EURC: 'EURC'
};

export type SettlementCurrency = (typeof SettlementCurrency)[keyof typeof SettlementCurrency]


export const TradeDirection: {
  YES: 'YES',
  NO: 'NO'
};

export type TradeDirection = (typeof TradeDirection)[keyof typeof TradeDirection]


export const TradeStatus: {
  PENDING: 'PENDING',
  EXECUTED: 'EXECUTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

export type TradeStatus = (typeof TradeStatus)[keyof typeof TradeStatus]


export const PositionStatus: {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  HEDGED: 'HEDGED',
  STOP_LOSS: 'STOP_LOSS'
};

export type PositionStatus = (typeof PositionStatus)[keyof typeof PositionStatus]


export const SubscriptionType: {
  PER_TRACE: 'PER_TRACE',
  DAILY_PASS: 'DAILY_PASS'
};

export type SubscriptionType = (typeof SubscriptionType)[keyof typeof SubscriptionType]


export const SubscriptionStatus: {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus]


export const AgentType: {
  MARKET_MAKER: 'MARKET_MAKER',
  TRADER: 'TRADER'
};

export type AgentType = (typeof AgentType)[keyof typeof AgentType]


export const LogLevel: {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

}

export type MarketStatus = $Enums.MarketStatus

export const MarketStatus: typeof $Enums.MarketStatus

export type MarketCategory = $Enums.MarketCategory

export const MarketCategory: typeof $Enums.MarketCategory

export type SettlementCurrency = $Enums.SettlementCurrency

export const SettlementCurrency: typeof $Enums.SettlementCurrency

export type TradeDirection = $Enums.TradeDirection

export const TradeDirection: typeof $Enums.TradeDirection

export type TradeStatus = $Enums.TradeStatus

export const TradeStatus: typeof $Enums.TradeStatus

export type PositionStatus = $Enums.PositionStatus

export const PositionStatus: typeof $Enums.PositionStatus

export type SubscriptionType = $Enums.SubscriptionType

export const SubscriptionType: typeof $Enums.SubscriptionType

export type SubscriptionStatus = $Enums.SubscriptionStatus

export const SubscriptionStatus: typeof $Enums.SubscriptionStatus

export type AgentType = $Enums.AgentType

export const AgentType: typeof $Enums.AgentType

export type LogLevel = $Enums.LogLevel

export const LogLevel: typeof $Enums.LogLevel

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Users
 * const users = await prisma.user.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Users
   * const users = await prisma.user.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.market`: Exposes CRUD operations for the **Market** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Markets
    * const markets = await prisma.market.findMany()
    * ```
    */
  get market(): Prisma.MarketDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.trade`: Exposes CRUD operations for the **Trade** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Trades
    * const trades = await prisma.trade.findMany()
    * ```
    */
  get trade(): Prisma.TradeDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.position`: Exposes CRUD operations for the **Position** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Positions
    * const positions = await prisma.position.findMany()
    * ```
    */
  get position(): Prisma.PositionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.reasoningTrace`: Exposes CRUD operations for the **ReasoningTrace** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ReasoningTraces
    * const reasoningTraces = await prisma.reasoningTrace.findMany()
    * ```
    */
  get reasoningTrace(): Prisma.ReasoningTraceDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.copyTrade`: Exposes CRUD operations for the **CopyTrade** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more CopyTrades
    * const copyTrades = await prisma.copyTrade.findMany()
    * ```
    */
  get copyTrade(): Prisma.CopyTradeDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.subscription`: Exposes CRUD operations for the **Subscription** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Subscriptions
    * const subscriptions = await prisma.subscription.findMany()
    * ```
    */
  get subscription(): Prisma.SubscriptionDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.agentLog`: Exposes CRUD operations for the **AgentLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AgentLogs
    * const agentLogs = await prisma.agentLog.findMany()
    * ```
    */
  get agentLog(): Prisma.AgentLogDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.signalCache`: Exposes CRUD operations for the **SignalCache** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more SignalCaches
    * const signalCaches = await prisma.signalCache.findMany()
    * ```
    */
  get signalCache(): Prisma.SignalCacheDelegate<ExtArgs, ClientOptions>;

  /**
   * `prisma.blockIndex`: Exposes CRUD operations for the **BlockIndex** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more BlockIndices
    * const blockIndices = await prisma.blockIndex.findMany()
    * ```
    */
  get blockIndex(): Prisma.BlockIndexDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 6.19.3
   * Query Engine version: c2990dca591cba766e3b7ef5d9e8a84796e47ab7
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import Bytes = runtime.Bytes
  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    User: 'User',
    Market: 'Market',
    Trade: 'Trade',
    Position: 'Position',
    ReasoningTrace: 'ReasoningTrace',
    CopyTrade: 'CopyTrade',
    Subscription: 'Subscription',
    AgentLog: 'AgentLog',
    SignalCache: 'SignalCache',
    BlockIndex: 'BlockIndex'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "user" | "market" | "trade" | "position" | "reasoningTrace" | "copyTrade" | "subscription" | "agentLog" | "signalCache" | "blockIndex"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.UserUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      Market: {
        payload: Prisma.$MarketPayload<ExtArgs>
        fields: Prisma.MarketFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MarketFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MarketFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          findFirst: {
            args: Prisma.MarketFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MarketFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          findMany: {
            args: Prisma.MarketFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>[]
          }
          create: {
            args: Prisma.MarketCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          createMany: {
            args: Prisma.MarketCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.MarketCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>[]
          }
          delete: {
            args: Prisma.MarketDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          update: {
            args: Prisma.MarketUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          deleteMany: {
            args: Prisma.MarketDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.MarketUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.MarketUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>[]
          }
          upsert: {
            args: Prisma.MarketUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$MarketPayload>
          }
          aggregate: {
            args: Prisma.MarketAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateMarket>
          }
          groupBy: {
            args: Prisma.MarketGroupByArgs<ExtArgs>
            result: $Utils.Optional<MarketGroupByOutputType>[]
          }
          count: {
            args: Prisma.MarketCountArgs<ExtArgs>
            result: $Utils.Optional<MarketCountAggregateOutputType> | number
          }
        }
      }
      Trade: {
        payload: Prisma.$TradePayload<ExtArgs>
        fields: Prisma.TradeFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TradeFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TradeFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          findFirst: {
            args: Prisma.TradeFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TradeFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          findMany: {
            args: Prisma.TradeFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>[]
          }
          create: {
            args: Prisma.TradeCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          createMany: {
            args: Prisma.TradeCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TradeCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>[]
          }
          delete: {
            args: Prisma.TradeDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          update: {
            args: Prisma.TradeUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          deleteMany: {
            args: Prisma.TradeDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TradeUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.TradeUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>[]
          }
          upsert: {
            args: Prisma.TradeUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TradePayload>
          }
          aggregate: {
            args: Prisma.TradeAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTrade>
          }
          groupBy: {
            args: Prisma.TradeGroupByArgs<ExtArgs>
            result: $Utils.Optional<TradeGroupByOutputType>[]
          }
          count: {
            args: Prisma.TradeCountArgs<ExtArgs>
            result: $Utils.Optional<TradeCountAggregateOutputType> | number
          }
        }
      }
      Position: {
        payload: Prisma.$PositionPayload<ExtArgs>
        fields: Prisma.PositionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PositionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PositionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          findFirst: {
            args: Prisma.PositionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PositionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          findMany: {
            args: Prisma.PositionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>[]
          }
          create: {
            args: Prisma.PositionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          createMany: {
            args: Prisma.PositionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.PositionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>[]
          }
          delete: {
            args: Prisma.PositionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          update: {
            args: Prisma.PositionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          deleteMany: {
            args: Prisma.PositionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.PositionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.PositionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>[]
          }
          upsert: {
            args: Prisma.PositionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$PositionPayload>
          }
          aggregate: {
            args: Prisma.PositionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePosition>
          }
          groupBy: {
            args: Prisma.PositionGroupByArgs<ExtArgs>
            result: $Utils.Optional<PositionGroupByOutputType>[]
          }
          count: {
            args: Prisma.PositionCountArgs<ExtArgs>
            result: $Utils.Optional<PositionCountAggregateOutputType> | number
          }
        }
      }
      ReasoningTrace: {
        payload: Prisma.$ReasoningTracePayload<ExtArgs>
        fields: Prisma.ReasoningTraceFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ReasoningTraceFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ReasoningTraceFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          findFirst: {
            args: Prisma.ReasoningTraceFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ReasoningTraceFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          findMany: {
            args: Prisma.ReasoningTraceFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>[]
          }
          create: {
            args: Prisma.ReasoningTraceCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          createMany: {
            args: Prisma.ReasoningTraceCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ReasoningTraceCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>[]
          }
          delete: {
            args: Prisma.ReasoningTraceDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          update: {
            args: Prisma.ReasoningTraceUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          deleteMany: {
            args: Prisma.ReasoningTraceDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ReasoningTraceUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.ReasoningTraceUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>[]
          }
          upsert: {
            args: Prisma.ReasoningTraceUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ReasoningTracePayload>
          }
          aggregate: {
            args: Prisma.ReasoningTraceAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateReasoningTrace>
          }
          groupBy: {
            args: Prisma.ReasoningTraceGroupByArgs<ExtArgs>
            result: $Utils.Optional<ReasoningTraceGroupByOutputType>[]
          }
          count: {
            args: Prisma.ReasoningTraceCountArgs<ExtArgs>
            result: $Utils.Optional<ReasoningTraceCountAggregateOutputType> | number
          }
        }
      }
      CopyTrade: {
        payload: Prisma.$CopyTradePayload<ExtArgs>
        fields: Prisma.CopyTradeFieldRefs
        operations: {
          findUnique: {
            args: Prisma.CopyTradeFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.CopyTradeFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          findFirst: {
            args: Prisma.CopyTradeFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.CopyTradeFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          findMany: {
            args: Prisma.CopyTradeFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>[]
          }
          create: {
            args: Prisma.CopyTradeCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          createMany: {
            args: Prisma.CopyTradeCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.CopyTradeCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>[]
          }
          delete: {
            args: Prisma.CopyTradeDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          update: {
            args: Prisma.CopyTradeUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          deleteMany: {
            args: Prisma.CopyTradeDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.CopyTradeUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.CopyTradeUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>[]
          }
          upsert: {
            args: Prisma.CopyTradeUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$CopyTradePayload>
          }
          aggregate: {
            args: Prisma.CopyTradeAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateCopyTrade>
          }
          groupBy: {
            args: Prisma.CopyTradeGroupByArgs<ExtArgs>
            result: $Utils.Optional<CopyTradeGroupByOutputType>[]
          }
          count: {
            args: Prisma.CopyTradeCountArgs<ExtArgs>
            result: $Utils.Optional<CopyTradeCountAggregateOutputType> | number
          }
        }
      }
      Subscription: {
        payload: Prisma.$SubscriptionPayload<ExtArgs>
        fields: Prisma.SubscriptionFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SubscriptionFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SubscriptionFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          findFirst: {
            args: Prisma.SubscriptionFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SubscriptionFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          findMany: {
            args: Prisma.SubscriptionFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          create: {
            args: Prisma.SubscriptionCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          createMany: {
            args: Prisma.SubscriptionCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SubscriptionCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          delete: {
            args: Prisma.SubscriptionDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          update: {
            args: Prisma.SubscriptionUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          deleteMany: {
            args: Prisma.SubscriptionDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SubscriptionUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SubscriptionUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>[]
          }
          upsert: {
            args: Prisma.SubscriptionUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SubscriptionPayload>
          }
          aggregate: {
            args: Prisma.SubscriptionAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSubscription>
          }
          groupBy: {
            args: Prisma.SubscriptionGroupByArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionGroupByOutputType>[]
          }
          count: {
            args: Prisma.SubscriptionCountArgs<ExtArgs>
            result: $Utils.Optional<SubscriptionCountAggregateOutputType> | number
          }
        }
      }
      AgentLog: {
        payload: Prisma.$AgentLogPayload<ExtArgs>
        fields: Prisma.AgentLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AgentLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AgentLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          findFirst: {
            args: Prisma.AgentLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AgentLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          findMany: {
            args: Prisma.AgentLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>[]
          }
          create: {
            args: Prisma.AgentLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          createMany: {
            args: Prisma.AgentLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AgentLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>[]
          }
          delete: {
            args: Prisma.AgentLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          update: {
            args: Prisma.AgentLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          deleteMany: {
            args: Prisma.AgentLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AgentLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.AgentLogUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>[]
          }
          upsert: {
            args: Prisma.AgentLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AgentLogPayload>
          }
          aggregate: {
            args: Prisma.AgentLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgentLog>
          }
          groupBy: {
            args: Prisma.AgentLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<AgentLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.AgentLogCountArgs<ExtArgs>
            result: $Utils.Optional<AgentLogCountAggregateOutputType> | number
          }
        }
      }
      SignalCache: {
        payload: Prisma.$SignalCachePayload<ExtArgs>
        fields: Prisma.SignalCacheFieldRefs
        operations: {
          findUnique: {
            args: Prisma.SignalCacheFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.SignalCacheFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          findFirst: {
            args: Prisma.SignalCacheFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.SignalCacheFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          findMany: {
            args: Prisma.SignalCacheFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>[]
          }
          create: {
            args: Prisma.SignalCacheCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          createMany: {
            args: Prisma.SignalCacheCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.SignalCacheCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>[]
          }
          delete: {
            args: Prisma.SignalCacheDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          update: {
            args: Prisma.SignalCacheUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          deleteMany: {
            args: Prisma.SignalCacheDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.SignalCacheUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.SignalCacheUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>[]
          }
          upsert: {
            args: Prisma.SignalCacheUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$SignalCachePayload>
          }
          aggregate: {
            args: Prisma.SignalCacheAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSignalCache>
          }
          groupBy: {
            args: Prisma.SignalCacheGroupByArgs<ExtArgs>
            result: $Utils.Optional<SignalCacheGroupByOutputType>[]
          }
          count: {
            args: Prisma.SignalCacheCountArgs<ExtArgs>
            result: $Utils.Optional<SignalCacheCountAggregateOutputType> | number
          }
        }
      }
      BlockIndex: {
        payload: Prisma.$BlockIndexPayload<ExtArgs>
        fields: Prisma.BlockIndexFieldRefs
        operations: {
          findUnique: {
            args: Prisma.BlockIndexFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.BlockIndexFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          findFirst: {
            args: Prisma.BlockIndexFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.BlockIndexFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          findMany: {
            args: Prisma.BlockIndexFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>[]
          }
          create: {
            args: Prisma.BlockIndexCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          createMany: {
            args: Prisma.BlockIndexCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.BlockIndexCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>[]
          }
          delete: {
            args: Prisma.BlockIndexDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          update: {
            args: Prisma.BlockIndexUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          deleteMany: {
            args: Prisma.BlockIndexDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.BlockIndexUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.BlockIndexUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>[]
          }
          upsert: {
            args: Prisma.BlockIndexUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BlockIndexPayload>
          }
          aggregate: {
            args: Prisma.BlockIndexAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateBlockIndex>
          }
          groupBy: {
            args: Prisma.BlockIndexGroupByArgs<ExtArgs>
            result: $Utils.Optional<BlockIndexGroupByOutputType>[]
          }
          count: {
            args: Prisma.BlockIndexCountArgs<ExtArgs>
            result: $Utils.Optional<BlockIndexCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-planetscale`
     */
    adapter?: runtime.SqlDriverAdapterFactory | null
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
  }
  export type GlobalOmitConfig = {
    user?: UserOmit
    market?: MarketOmit
    trade?: TradeOmit
    position?: PositionOmit
    reasoningTrace?: ReasoningTraceOmit
    copyTrade?: CopyTradeOmit
    subscription?: SubscriptionOmit
    agentLog?: AgentLogOmit
    signalCache?: SignalCacheOmit
    blockIndex?: BlockIndexOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type UserCountOutputType
   */

  export type UserCountOutputType = {
    subscriptions: number
    copyTrades: number
  }

  export type UserCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptions?: boolean | UserCountOutputTypeCountSubscriptionsArgs
    copyTrades?: boolean | UserCountOutputTypeCountCopyTradesArgs
  }

  // Custom InputTypes
  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserCountOutputType
     */
    select?: UserCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountSubscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountCopyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CopyTradeWhereInput
  }


  /**
   * Count Type MarketCountOutputType
   */

  export type MarketCountOutputType = {
    trades: number
    positions: number
    reasoningTraces: number
    copyTrades: number
    agentLogs: number
  }

  export type MarketCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    trades?: boolean | MarketCountOutputTypeCountTradesArgs
    positions?: boolean | MarketCountOutputTypeCountPositionsArgs
    reasoningTraces?: boolean | MarketCountOutputTypeCountReasoningTracesArgs
    copyTrades?: boolean | MarketCountOutputTypeCountCopyTradesArgs
    agentLogs?: boolean | MarketCountOutputTypeCountAgentLogsArgs
  }

  // Custom InputTypes
  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketCountOutputType
     */
    select?: MarketCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeCountTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TradeWhereInput
  }

  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeCountPositionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PositionWhereInput
  }

  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeCountReasoningTracesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ReasoningTraceWhereInput
  }

  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeCountCopyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CopyTradeWhereInput
  }

  /**
   * MarketCountOutputType without action
   */
  export type MarketCountOutputTypeCountAgentLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentLogWhereInput
  }


  /**
   * Count Type TradeCountOutputType
   */

  export type TradeCountOutputType = {
    copyTrades: number
  }

  export type TradeCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    copyTrades?: boolean | TradeCountOutputTypeCountCopyTradesArgs
  }

  // Custom InputTypes
  /**
   * TradeCountOutputType without action
   */
  export type TradeCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TradeCountOutputType
     */
    select?: TradeCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TradeCountOutputType without action
   */
  export type TradeCountOutputTypeCountCopyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CopyTradeWhereInput
  }


  /**
   * Count Type ReasoningTraceCountOutputType
   */

  export type ReasoningTraceCountOutputType = {
    copyTrades: number
    subscriptions: number
  }

  export type ReasoningTraceCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    copyTrades?: boolean | ReasoningTraceCountOutputTypeCountCopyTradesArgs
    subscriptions?: boolean | ReasoningTraceCountOutputTypeCountSubscriptionsArgs
  }

  // Custom InputTypes
  /**
   * ReasoningTraceCountOutputType without action
   */
  export type ReasoningTraceCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTraceCountOutputType
     */
    select?: ReasoningTraceCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * ReasoningTraceCountOutputType without action
   */
  export type ReasoningTraceCountOutputTypeCountCopyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CopyTradeWhereInput
  }

  /**
   * ReasoningTraceCountOutputType without action
   */
  export type ReasoningTraceCountOutputTypeCountSubscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
  }


  /**
   * Models
   */

  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserMinAggregateOutputType = {
    id: string | null
    walletAddress: string | null
    email: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserMaxAggregateOutputType = {
    id: string | null
    walletAddress: string | null
    email: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserCountAggregateOutputType = {
    id: number
    walletAddress: number
    email: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserMinAggregateInputType = {
    id?: true
    walletAddress?: true
    email?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserMaxAggregateInputType = {
    id?: true
    walletAddress?: true
    email?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserCountAggregateInputType = {
    id?: true
    walletAddress?: true
    email?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    id: string
    walletAddress: string
    email: string | null
    createdAt: Date
    updatedAt: Date
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    walletAddress?: boolean
    email?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    subscriptions?: boolean | User$subscriptionsArgs<ExtArgs>
    copyTrades?: boolean | User$copyTradesArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    walletAddress?: boolean
    email?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    walletAddress?: boolean
    email?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    id?: boolean
    walletAddress?: boolean
    email?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "walletAddress" | "email" | "createdAt" | "updatedAt", ExtArgs["result"]["user"]>
  export type UserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    subscriptions?: boolean | User$subscriptionsArgs<ExtArgs>
    copyTrades?: boolean | User$copyTradesArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type UserIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type UserIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {
      subscriptions: Prisma.$SubscriptionPayload<ExtArgs>[]
      copyTrades: Prisma.$CopyTradePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      walletAddress: string
      email: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["user"]>
    composites: {}
  }

  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserFindUniqueArgs>(args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one User that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserFindFirstArgs>(args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userWithIdOnly = await prisma.user.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserFindManyArgs>(args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
     */
    create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Users.
     * @param {UserCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserCreateManyArgs>(args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {UserCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `id`
     * const userWithIdOnly = await prisma.user.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
     */
    delete<T extends UserDeleteArgs>(args: SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserDeleteManyArgs>(args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserUpdateManyArgs>(args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users and returns the data updated in the database.
     * @param {UserUpdateManyAndReturnArgs} args - Arguments to update many Users.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Users and only return the `id`
     * const userWithIdOnly = await prisma.user.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends UserUpdateManyAndReturnArgs>(args: SelectSubset<T, UserUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
     */
    upsert<T extends UserUpsertArgs>(args: SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    subscriptions<T extends User$subscriptionsArgs<ExtArgs> = {}>(args?: Subset<T, User$subscriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    copyTrades<T extends User$copyTradesArgs<ExtArgs> = {}>(args?: Subset<T, User$copyTradesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the User model
   */
  interface UserFieldRefs {
    readonly id: FieldRef<"User", 'String'>
    readonly walletAddress: FieldRef<"User", 'String'>
    readonly email: FieldRef<"User", 'String'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }

  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User createManyAndReturn
   */
  export type UserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to update.
     */
    limit?: number
  }

  /**
   * User updateManyAndReturn
   */
  export type UserUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to update.
     */
    limit?: number
  }

  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }

  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
    /**
     * Limit how many Users to delete.
     */
    limit?: number
  }

  /**
   * User.subscriptions
   */
  export type User$subscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * User.copyTrades
   */
  export type User$copyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    where?: CopyTradeWhereInput
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    cursor?: CopyTradeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Omit specific fields from the User
     */
    omit?: UserOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
  }


  /**
   * Model Market
   */

  export type AggregateMarket = {
    _count: MarketCountAggregateOutputType | null
    _avg: MarketAvgAggregateOutputType | null
    _sum: MarketSumAggregateOutputType | null
    _min: MarketMinAggregateOutputType | null
    _max: MarketMaxAggregateOutputType | null
  }

  export type MarketAvgAggregateOutputType = {
    initialYesProb: number | null
    currentYesProb: number | null
    minimumLiquidity: number | null
    totalLiquidity: number | null
  }

  export type MarketSumAggregateOutputType = {
    initialYesProb: number | null
    currentYesProb: number | null
    minimumLiquidity: number | null
    totalLiquidity: number | null
  }

  export type MarketMinAggregateOutputType = {
    id: string | null
    question: string | null
    category: $Enums.MarketCategory | null
    status: $Enums.MarketStatus | null
    settlementCurrency: $Enums.SettlementCurrency | null
    initialYesProb: number | null
    currentYesProb: number | null
    expiryTimestamp: Date | null
    resolutionOracle: string | null
    minimumLiquidity: number | null
    totalLiquidity: number | null
    onChainAddress: string | null
    txHash: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MarketMaxAggregateOutputType = {
    id: string | null
    question: string | null
    category: $Enums.MarketCategory | null
    status: $Enums.MarketStatus | null
    settlementCurrency: $Enums.SettlementCurrency | null
    initialYesProb: number | null
    currentYesProb: number | null
    expiryTimestamp: Date | null
    resolutionOracle: string | null
    minimumLiquidity: number | null
    totalLiquidity: number | null
    onChainAddress: string | null
    txHash: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MarketCountAggregateOutputType = {
    id: number
    question: number
    category: number
    status: number
    settlementCurrency: number
    initialYesProb: number
    currentYesProb: number
    confidenceInterval: number
    expiryTimestamp: number
    resolutionOracle: number
    minimumLiquidity: number
    totalLiquidity: number
    onChainAddress: number
    txHash: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type MarketAvgAggregateInputType = {
    initialYesProb?: true
    currentYesProb?: true
    minimumLiquidity?: true
    totalLiquidity?: true
  }

  export type MarketSumAggregateInputType = {
    initialYesProb?: true
    currentYesProb?: true
    minimumLiquidity?: true
    totalLiquidity?: true
  }

  export type MarketMinAggregateInputType = {
    id?: true
    question?: true
    category?: true
    status?: true
    settlementCurrency?: true
    initialYesProb?: true
    currentYesProb?: true
    expiryTimestamp?: true
    resolutionOracle?: true
    minimumLiquidity?: true
    totalLiquidity?: true
    onChainAddress?: true
    txHash?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MarketMaxAggregateInputType = {
    id?: true
    question?: true
    category?: true
    status?: true
    settlementCurrency?: true
    initialYesProb?: true
    currentYesProb?: true
    expiryTimestamp?: true
    resolutionOracle?: true
    minimumLiquidity?: true
    totalLiquidity?: true
    onChainAddress?: true
    txHash?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MarketCountAggregateInputType = {
    id?: true
    question?: true
    category?: true
    status?: true
    settlementCurrency?: true
    initialYesProb?: true
    currentYesProb?: true
    confidenceInterval?: true
    expiryTimestamp?: true
    resolutionOracle?: true
    minimumLiquidity?: true
    totalLiquidity?: true
    onChainAddress?: true
    txHash?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MarketAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Market to aggregate.
     */
    where?: MarketWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Markets to fetch.
     */
    orderBy?: MarketOrderByWithRelationInput | MarketOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MarketWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Markets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Markets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Markets
    **/
    _count?: true | MarketCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MarketAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MarketSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MarketMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MarketMaxAggregateInputType
  }

  export type GetMarketAggregateType<T extends MarketAggregateArgs> = {
        [P in keyof T & keyof AggregateMarket]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMarket[P]>
      : GetScalarType<T[P], AggregateMarket[P]>
  }




  export type MarketGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MarketWhereInput
    orderBy?: MarketOrderByWithAggregationInput | MarketOrderByWithAggregationInput[]
    by: MarketScalarFieldEnum[] | MarketScalarFieldEnum
    having?: MarketScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MarketCountAggregateInputType | true
    _avg?: MarketAvgAggregateInputType
    _sum?: MarketSumAggregateInputType
    _min?: MarketMinAggregateInputType
    _max?: MarketMaxAggregateInputType
  }

  export type MarketGroupByOutputType = {
    id: string
    question: string
    category: $Enums.MarketCategory
    status: $Enums.MarketStatus
    settlementCurrency: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb: number | null
    confidenceInterval: JsonValue
    expiryTimestamp: Date
    resolutionOracle: string | null
    minimumLiquidity: number
    totalLiquidity: number
    onChainAddress: string | null
    txHash: string | null
    createdAt: Date
    updatedAt: Date
    _count: MarketCountAggregateOutputType | null
    _avg: MarketAvgAggregateOutputType | null
    _sum: MarketSumAggregateOutputType | null
    _min: MarketMinAggregateOutputType | null
    _max: MarketMaxAggregateOutputType | null
  }

  type GetMarketGroupByPayload<T extends MarketGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MarketGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MarketGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MarketGroupByOutputType[P]>
            : GetScalarType<T[P], MarketGroupByOutputType[P]>
        }
      >
    >


  export type MarketSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    question?: boolean
    category?: boolean
    status?: boolean
    settlementCurrency?: boolean
    initialYesProb?: boolean
    currentYesProb?: boolean
    confidenceInterval?: boolean
    expiryTimestamp?: boolean
    resolutionOracle?: boolean
    minimumLiquidity?: boolean
    totalLiquidity?: boolean
    onChainAddress?: boolean
    txHash?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    trades?: boolean | Market$tradesArgs<ExtArgs>
    positions?: boolean | Market$positionsArgs<ExtArgs>
    reasoningTraces?: boolean | Market$reasoningTracesArgs<ExtArgs>
    copyTrades?: boolean | Market$copyTradesArgs<ExtArgs>
    agentLogs?: boolean | Market$agentLogsArgs<ExtArgs>
    _count?: boolean | MarketCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["market"]>

  export type MarketSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    question?: boolean
    category?: boolean
    status?: boolean
    settlementCurrency?: boolean
    initialYesProb?: boolean
    currentYesProb?: boolean
    confidenceInterval?: boolean
    expiryTimestamp?: boolean
    resolutionOracle?: boolean
    minimumLiquidity?: boolean
    totalLiquidity?: boolean
    onChainAddress?: boolean
    txHash?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["market"]>

  export type MarketSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    question?: boolean
    category?: boolean
    status?: boolean
    settlementCurrency?: boolean
    initialYesProb?: boolean
    currentYesProb?: boolean
    confidenceInterval?: boolean
    expiryTimestamp?: boolean
    resolutionOracle?: boolean
    minimumLiquidity?: boolean
    totalLiquidity?: boolean
    onChainAddress?: boolean
    txHash?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["market"]>

  export type MarketSelectScalar = {
    id?: boolean
    question?: boolean
    category?: boolean
    status?: boolean
    settlementCurrency?: boolean
    initialYesProb?: boolean
    currentYesProb?: boolean
    confidenceInterval?: boolean
    expiryTimestamp?: boolean
    resolutionOracle?: boolean
    minimumLiquidity?: boolean
    totalLiquidity?: boolean
    onChainAddress?: boolean
    txHash?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type MarketOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "question" | "category" | "status" | "settlementCurrency" | "initialYesProb" | "currentYesProb" | "confidenceInterval" | "expiryTimestamp" | "resolutionOracle" | "minimumLiquidity" | "totalLiquidity" | "onChainAddress" | "txHash" | "createdAt" | "updatedAt", ExtArgs["result"]["market"]>
  export type MarketInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    trades?: boolean | Market$tradesArgs<ExtArgs>
    positions?: boolean | Market$positionsArgs<ExtArgs>
    reasoningTraces?: boolean | Market$reasoningTracesArgs<ExtArgs>
    copyTrades?: boolean | Market$copyTradesArgs<ExtArgs>
    agentLogs?: boolean | Market$agentLogsArgs<ExtArgs>
    _count?: boolean | MarketCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type MarketIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}
  export type MarketIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $MarketPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Market"
    objects: {
      trades: Prisma.$TradePayload<ExtArgs>[]
      positions: Prisma.$PositionPayload<ExtArgs>[]
      reasoningTraces: Prisma.$ReasoningTracePayload<ExtArgs>[]
      copyTrades: Prisma.$CopyTradePayload<ExtArgs>[]
      agentLogs: Prisma.$AgentLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      question: string
      category: $Enums.MarketCategory
      status: $Enums.MarketStatus
      settlementCurrency: $Enums.SettlementCurrency
      initialYesProb: number
      currentYesProb: number | null
      confidenceInterval: Prisma.JsonValue
      expiryTimestamp: Date
      resolutionOracle: string | null
      minimumLiquidity: number
      totalLiquidity: number
      onChainAddress: string | null
      txHash: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["market"]>
    composites: {}
  }

  type MarketGetPayload<S extends boolean | null | undefined | MarketDefaultArgs> = $Result.GetResult<Prisma.$MarketPayload, S>

  type MarketCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<MarketFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: MarketCountAggregateInputType | true
    }

  export interface MarketDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Market'], meta: { name: 'Market' } }
    /**
     * Find zero or one Market that matches the filter.
     * @param {MarketFindUniqueArgs} args - Arguments to find a Market
     * @example
     * // Get one Market
     * const market = await prisma.market.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends MarketFindUniqueArgs>(args: SelectSubset<T, MarketFindUniqueArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Market that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {MarketFindUniqueOrThrowArgs} args - Arguments to find a Market
     * @example
     * // Get one Market
     * const market = await prisma.market.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends MarketFindUniqueOrThrowArgs>(args: SelectSubset<T, MarketFindUniqueOrThrowArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Market that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketFindFirstArgs} args - Arguments to find a Market
     * @example
     * // Get one Market
     * const market = await prisma.market.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends MarketFindFirstArgs>(args?: SelectSubset<T, MarketFindFirstArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Market that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketFindFirstOrThrowArgs} args - Arguments to find a Market
     * @example
     * // Get one Market
     * const market = await prisma.market.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends MarketFindFirstOrThrowArgs>(args?: SelectSubset<T, MarketFindFirstOrThrowArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Markets that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Markets
     * const markets = await prisma.market.findMany()
     * 
     * // Get first 10 Markets
     * const markets = await prisma.market.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const marketWithIdOnly = await prisma.market.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends MarketFindManyArgs>(args?: SelectSubset<T, MarketFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Market.
     * @param {MarketCreateArgs} args - Arguments to create a Market.
     * @example
     * // Create one Market
     * const Market = await prisma.market.create({
     *   data: {
     *     // ... data to create a Market
     *   }
     * })
     * 
     */
    create<T extends MarketCreateArgs>(args: SelectSubset<T, MarketCreateArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Markets.
     * @param {MarketCreateManyArgs} args - Arguments to create many Markets.
     * @example
     * // Create many Markets
     * const market = await prisma.market.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends MarketCreateManyArgs>(args?: SelectSubset<T, MarketCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Markets and returns the data saved in the database.
     * @param {MarketCreateManyAndReturnArgs} args - Arguments to create many Markets.
     * @example
     * // Create many Markets
     * const market = await prisma.market.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Markets and only return the `id`
     * const marketWithIdOnly = await prisma.market.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends MarketCreateManyAndReturnArgs>(args?: SelectSubset<T, MarketCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Market.
     * @param {MarketDeleteArgs} args - Arguments to delete one Market.
     * @example
     * // Delete one Market
     * const Market = await prisma.market.delete({
     *   where: {
     *     // ... filter to delete one Market
     *   }
     * })
     * 
     */
    delete<T extends MarketDeleteArgs>(args: SelectSubset<T, MarketDeleteArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Market.
     * @param {MarketUpdateArgs} args - Arguments to update one Market.
     * @example
     * // Update one Market
     * const market = await prisma.market.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends MarketUpdateArgs>(args: SelectSubset<T, MarketUpdateArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Markets.
     * @param {MarketDeleteManyArgs} args - Arguments to filter Markets to delete.
     * @example
     * // Delete a few Markets
     * const { count } = await prisma.market.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends MarketDeleteManyArgs>(args?: SelectSubset<T, MarketDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Markets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Markets
     * const market = await prisma.market.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends MarketUpdateManyArgs>(args: SelectSubset<T, MarketUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Markets and returns the data updated in the database.
     * @param {MarketUpdateManyAndReturnArgs} args - Arguments to update many Markets.
     * @example
     * // Update many Markets
     * const market = await prisma.market.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Markets and only return the `id`
     * const marketWithIdOnly = await prisma.market.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends MarketUpdateManyAndReturnArgs>(args: SelectSubset<T, MarketUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Market.
     * @param {MarketUpsertArgs} args - Arguments to update or create a Market.
     * @example
     * // Update or create a Market
     * const market = await prisma.market.upsert({
     *   create: {
     *     // ... data to create a Market
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Market we want to update
     *   }
     * })
     */
    upsert<T extends MarketUpsertArgs>(args: SelectSubset<T, MarketUpsertArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Markets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketCountArgs} args - Arguments to filter Markets to count.
     * @example
     * // Count the number of Markets
     * const count = await prisma.market.count({
     *   where: {
     *     // ... the filter for the Markets we want to count
     *   }
     * })
    **/
    count<T extends MarketCountArgs>(
      args?: Subset<T, MarketCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MarketCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Market.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MarketAggregateArgs>(args: Subset<T, MarketAggregateArgs>): Prisma.PrismaPromise<GetMarketAggregateType<T>>

    /**
     * Group by Market.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MarketGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MarketGroupByArgs['orderBy'] }
        : { orderBy?: MarketGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MarketGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMarketGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Market model
   */
  readonly fields: MarketFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Market.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MarketClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    trades<T extends Market$tradesArgs<ExtArgs> = {}>(args?: Subset<T, Market$tradesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    positions<T extends Market$positionsArgs<ExtArgs> = {}>(args?: Subset<T, Market$positionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    reasoningTraces<T extends Market$reasoningTracesArgs<ExtArgs> = {}>(args?: Subset<T, Market$reasoningTracesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    copyTrades<T extends Market$copyTradesArgs<ExtArgs> = {}>(args?: Subset<T, Market$copyTradesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    agentLogs<T extends Market$agentLogsArgs<ExtArgs> = {}>(args?: Subset<T, Market$agentLogsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Market model
   */
  interface MarketFieldRefs {
    readonly id: FieldRef<"Market", 'String'>
    readonly question: FieldRef<"Market", 'String'>
    readonly category: FieldRef<"Market", 'MarketCategory'>
    readonly status: FieldRef<"Market", 'MarketStatus'>
    readonly settlementCurrency: FieldRef<"Market", 'SettlementCurrency'>
    readonly initialYesProb: FieldRef<"Market", 'Float'>
    readonly currentYesProb: FieldRef<"Market", 'Float'>
    readonly confidenceInterval: FieldRef<"Market", 'Json'>
    readonly expiryTimestamp: FieldRef<"Market", 'DateTime'>
    readonly resolutionOracle: FieldRef<"Market", 'String'>
    readonly minimumLiquidity: FieldRef<"Market", 'Float'>
    readonly totalLiquidity: FieldRef<"Market", 'Float'>
    readonly onChainAddress: FieldRef<"Market", 'String'>
    readonly txHash: FieldRef<"Market", 'String'>
    readonly createdAt: FieldRef<"Market", 'DateTime'>
    readonly updatedAt: FieldRef<"Market", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Market findUnique
   */
  export type MarketFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter, which Market to fetch.
     */
    where: MarketWhereUniqueInput
  }

  /**
   * Market findUniqueOrThrow
   */
  export type MarketFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter, which Market to fetch.
     */
    where: MarketWhereUniqueInput
  }

  /**
   * Market findFirst
   */
  export type MarketFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter, which Market to fetch.
     */
    where?: MarketWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Markets to fetch.
     */
    orderBy?: MarketOrderByWithRelationInput | MarketOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Markets.
     */
    cursor?: MarketWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Markets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Markets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Markets.
     */
    distinct?: MarketScalarFieldEnum | MarketScalarFieldEnum[]
  }

  /**
   * Market findFirstOrThrow
   */
  export type MarketFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter, which Market to fetch.
     */
    where?: MarketWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Markets to fetch.
     */
    orderBy?: MarketOrderByWithRelationInput | MarketOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Markets.
     */
    cursor?: MarketWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Markets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Markets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Markets.
     */
    distinct?: MarketScalarFieldEnum | MarketScalarFieldEnum[]
  }

  /**
   * Market findMany
   */
  export type MarketFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter, which Markets to fetch.
     */
    where?: MarketWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Markets to fetch.
     */
    orderBy?: MarketOrderByWithRelationInput | MarketOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Markets.
     */
    cursor?: MarketWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Markets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Markets.
     */
    skip?: number
    distinct?: MarketScalarFieldEnum | MarketScalarFieldEnum[]
  }

  /**
   * Market create
   */
  export type MarketCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * The data needed to create a Market.
     */
    data: XOR<MarketCreateInput, MarketUncheckedCreateInput>
  }

  /**
   * Market createMany
   */
  export type MarketCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Markets.
     */
    data: MarketCreateManyInput | MarketCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Market createManyAndReturn
   */
  export type MarketCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * The data used to create many Markets.
     */
    data: MarketCreateManyInput | MarketCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Market update
   */
  export type MarketUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * The data needed to update a Market.
     */
    data: XOR<MarketUpdateInput, MarketUncheckedUpdateInput>
    /**
     * Choose, which Market to update.
     */
    where: MarketWhereUniqueInput
  }

  /**
   * Market updateMany
   */
  export type MarketUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Markets.
     */
    data: XOR<MarketUpdateManyMutationInput, MarketUncheckedUpdateManyInput>
    /**
     * Filter which Markets to update
     */
    where?: MarketWhereInput
    /**
     * Limit how many Markets to update.
     */
    limit?: number
  }

  /**
   * Market updateManyAndReturn
   */
  export type MarketUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * The data used to update Markets.
     */
    data: XOR<MarketUpdateManyMutationInput, MarketUncheckedUpdateManyInput>
    /**
     * Filter which Markets to update
     */
    where?: MarketWhereInput
    /**
     * Limit how many Markets to update.
     */
    limit?: number
  }

  /**
   * Market upsert
   */
  export type MarketUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * The filter to search for the Market to update in case it exists.
     */
    where: MarketWhereUniqueInput
    /**
     * In case the Market found by the `where` argument doesn't exist, create a new Market with this data.
     */
    create: XOR<MarketCreateInput, MarketUncheckedCreateInput>
    /**
     * In case the Market was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MarketUpdateInput, MarketUncheckedUpdateInput>
  }

  /**
   * Market delete
   */
  export type MarketDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    /**
     * Filter which Market to delete.
     */
    where: MarketWhereUniqueInput
  }

  /**
   * Market deleteMany
   */
  export type MarketDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Markets to delete
     */
    where?: MarketWhereInput
    /**
     * Limit how many Markets to delete.
     */
    limit?: number
  }

  /**
   * Market.trades
   */
  export type Market$tradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    where?: TradeWhereInput
    orderBy?: TradeOrderByWithRelationInput | TradeOrderByWithRelationInput[]
    cursor?: TradeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TradeScalarFieldEnum | TradeScalarFieldEnum[]
  }

  /**
   * Market.positions
   */
  export type Market$positionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    where?: PositionWhereInput
    orderBy?: PositionOrderByWithRelationInput | PositionOrderByWithRelationInput[]
    cursor?: PositionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: PositionScalarFieldEnum | PositionScalarFieldEnum[]
  }

  /**
   * Market.reasoningTraces
   */
  export type Market$reasoningTracesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    where?: ReasoningTraceWhereInput
    orderBy?: ReasoningTraceOrderByWithRelationInput | ReasoningTraceOrderByWithRelationInput[]
    cursor?: ReasoningTraceWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ReasoningTraceScalarFieldEnum | ReasoningTraceScalarFieldEnum[]
  }

  /**
   * Market.copyTrades
   */
  export type Market$copyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    where?: CopyTradeWhereInput
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    cursor?: CopyTradeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * Market.agentLogs
   */
  export type Market$agentLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    where?: AgentLogWhereInput
    orderBy?: AgentLogOrderByWithRelationInput | AgentLogOrderByWithRelationInput[]
    cursor?: AgentLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AgentLogScalarFieldEnum | AgentLogScalarFieldEnum[]
  }

  /**
   * Market without action
   */
  export type MarketDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
  }


  /**
   * Model Trade
   */

  export type AggregateTrade = {
    _count: TradeCountAggregateOutputType | null
    _avg: TradeAvgAggregateOutputType | null
    _sum: TradeSumAggregateOutputType | null
    _min: TradeMinAggregateOutputType | null
    _max: TradeMaxAggregateOutputType | null
  }

  export type TradeAvgAggregateOutputType = {
    amount: number | null
    price: number | null
    edgeDetected: number | null
    kellyFraction: number | null
    builderFee: number | null
  }

  export type TradeSumAggregateOutputType = {
    amount: number | null
    price: number | null
    edgeDetected: number | null
    kellyFraction: number | null
    builderFee: number | null
  }

  export type TradeMinAggregateOutputType = {
    id: string | null
    marketId: string | null
    direction: $Enums.TradeDirection | null
    status: $Enums.TradeStatus | null
    amount: number | null
    price: number | null
    edgeDetected: number | null
    kellyFraction: number | null
    txHash: string | null
    builderFee: number | null
    errorMessage: string | null
    executedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TradeMaxAggregateOutputType = {
    id: string | null
    marketId: string | null
    direction: $Enums.TradeDirection | null
    status: $Enums.TradeStatus | null
    amount: number | null
    price: number | null
    edgeDetected: number | null
    kellyFraction: number | null
    txHash: string | null
    builderFee: number | null
    errorMessage: string | null
    executedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TradeCountAggregateOutputType = {
    id: number
    marketId: number
    direction: number
    status: number
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash: number
    builderFee: number
    errorMessage: number
    executedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TradeAvgAggregateInputType = {
    amount?: true
    price?: true
    edgeDetected?: true
    kellyFraction?: true
    builderFee?: true
  }

  export type TradeSumAggregateInputType = {
    amount?: true
    price?: true
    edgeDetected?: true
    kellyFraction?: true
    builderFee?: true
  }

  export type TradeMinAggregateInputType = {
    id?: true
    marketId?: true
    direction?: true
    status?: true
    amount?: true
    price?: true
    edgeDetected?: true
    kellyFraction?: true
    txHash?: true
    builderFee?: true
    errorMessage?: true
    executedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TradeMaxAggregateInputType = {
    id?: true
    marketId?: true
    direction?: true
    status?: true
    amount?: true
    price?: true
    edgeDetected?: true
    kellyFraction?: true
    txHash?: true
    builderFee?: true
    errorMessage?: true
    executedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TradeCountAggregateInputType = {
    id?: true
    marketId?: true
    direction?: true
    status?: true
    amount?: true
    price?: true
    edgeDetected?: true
    kellyFraction?: true
    txHash?: true
    builderFee?: true
    errorMessage?: true
    executedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TradeAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Trade to aggregate.
     */
    where?: TradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Trades to fetch.
     */
    orderBy?: TradeOrderByWithRelationInput | TradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Trades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Trades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Trades
    **/
    _count?: true | TradeCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: TradeAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: TradeSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TradeMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TradeMaxAggregateInputType
  }

  export type GetTradeAggregateType<T extends TradeAggregateArgs> = {
        [P in keyof T & keyof AggregateTrade]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTrade[P]>
      : GetScalarType<T[P], AggregateTrade[P]>
  }




  export type TradeGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TradeWhereInput
    orderBy?: TradeOrderByWithAggregationInput | TradeOrderByWithAggregationInput[]
    by: TradeScalarFieldEnum[] | TradeScalarFieldEnum
    having?: TradeScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TradeCountAggregateInputType | true
    _avg?: TradeAvgAggregateInputType
    _sum?: TradeSumAggregateInputType
    _min?: TradeMinAggregateInputType
    _max?: TradeMaxAggregateInputType
  }

  export type TradeGroupByOutputType = {
    id: string
    marketId: string
    direction: $Enums.TradeDirection
    status: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash: string | null
    builderFee: number
    errorMessage: string | null
    executedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: TradeCountAggregateOutputType | null
    _avg: TradeAvgAggregateOutputType | null
    _sum: TradeSumAggregateOutputType | null
    _min: TradeMinAggregateOutputType | null
    _max: TradeMaxAggregateOutputType | null
  }

  type GetTradeGroupByPayload<T extends TradeGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TradeGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TradeGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TradeGroupByOutputType[P]>
            : GetScalarType<T[P], TradeGroupByOutputType[P]>
        }
      >
    >


  export type TradeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    direction?: boolean
    status?: boolean
    amount?: boolean
    price?: boolean
    edgeDetected?: boolean
    kellyFraction?: boolean
    txHash?: boolean
    builderFee?: boolean
    errorMessage?: boolean
    executedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
    position?: boolean | Trade$positionArgs<ExtArgs>
    copyTrades?: boolean | Trade$copyTradesArgs<ExtArgs>
    _count?: boolean | TradeCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trade"]>

  export type TradeSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    direction?: boolean
    status?: boolean
    amount?: boolean
    price?: boolean
    edgeDetected?: boolean
    kellyFraction?: boolean
    txHash?: boolean
    builderFee?: boolean
    errorMessage?: boolean
    executedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trade"]>

  export type TradeSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    direction?: boolean
    status?: boolean
    amount?: boolean
    price?: boolean
    edgeDetected?: boolean
    kellyFraction?: boolean
    txHash?: boolean
    builderFee?: boolean
    errorMessage?: boolean
    executedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["trade"]>

  export type TradeSelectScalar = {
    id?: boolean
    marketId?: boolean
    direction?: boolean
    status?: boolean
    amount?: boolean
    price?: boolean
    edgeDetected?: boolean
    kellyFraction?: boolean
    txHash?: boolean
    builderFee?: boolean
    errorMessage?: boolean
    executedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TradeOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "marketId" | "direction" | "status" | "amount" | "price" | "edgeDetected" | "kellyFraction" | "txHash" | "builderFee" | "errorMessage" | "executedAt" | "createdAt" | "updatedAt", ExtArgs["result"]["trade"]>
  export type TradeInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
    position?: boolean | Trade$positionArgs<ExtArgs>
    copyTrades?: boolean | Trade$copyTradesArgs<ExtArgs>
    _count?: boolean | TradeCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TradeIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }
  export type TradeIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }

  export type $TradePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Trade"
    objects: {
      market: Prisma.$MarketPayload<ExtArgs>
      position: Prisma.$PositionPayload<ExtArgs> | null
      copyTrades: Prisma.$CopyTradePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      marketId: string
      direction: $Enums.TradeDirection
      status: $Enums.TradeStatus
      amount: number
      price: number
      edgeDetected: number
      kellyFraction: number
      txHash: string | null
      builderFee: number
      errorMessage: string | null
      executedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["trade"]>
    composites: {}
  }

  type TradeGetPayload<S extends boolean | null | undefined | TradeDefaultArgs> = $Result.GetResult<Prisma.$TradePayload, S>

  type TradeCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<TradeFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: TradeCountAggregateInputType | true
    }

  export interface TradeDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Trade'], meta: { name: 'Trade' } }
    /**
     * Find zero or one Trade that matches the filter.
     * @param {TradeFindUniqueArgs} args - Arguments to find a Trade
     * @example
     * // Get one Trade
     * const trade = await prisma.trade.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TradeFindUniqueArgs>(args: SelectSubset<T, TradeFindUniqueArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Trade that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {TradeFindUniqueOrThrowArgs} args - Arguments to find a Trade
     * @example
     * // Get one Trade
     * const trade = await prisma.trade.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TradeFindUniqueOrThrowArgs>(args: SelectSubset<T, TradeFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Trade that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeFindFirstArgs} args - Arguments to find a Trade
     * @example
     * // Get one Trade
     * const trade = await prisma.trade.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TradeFindFirstArgs>(args?: SelectSubset<T, TradeFindFirstArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Trade that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeFindFirstOrThrowArgs} args - Arguments to find a Trade
     * @example
     * // Get one Trade
     * const trade = await prisma.trade.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TradeFindFirstOrThrowArgs>(args?: SelectSubset<T, TradeFindFirstOrThrowArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Trades that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Trades
     * const trades = await prisma.trade.findMany()
     * 
     * // Get first 10 Trades
     * const trades = await prisma.trade.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const tradeWithIdOnly = await prisma.trade.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TradeFindManyArgs>(args?: SelectSubset<T, TradeFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Trade.
     * @param {TradeCreateArgs} args - Arguments to create a Trade.
     * @example
     * // Create one Trade
     * const Trade = await prisma.trade.create({
     *   data: {
     *     // ... data to create a Trade
     *   }
     * })
     * 
     */
    create<T extends TradeCreateArgs>(args: SelectSubset<T, TradeCreateArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Trades.
     * @param {TradeCreateManyArgs} args - Arguments to create many Trades.
     * @example
     * // Create many Trades
     * const trade = await prisma.trade.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TradeCreateManyArgs>(args?: SelectSubset<T, TradeCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Trades and returns the data saved in the database.
     * @param {TradeCreateManyAndReturnArgs} args - Arguments to create many Trades.
     * @example
     * // Create many Trades
     * const trade = await prisma.trade.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Trades and only return the `id`
     * const tradeWithIdOnly = await prisma.trade.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TradeCreateManyAndReturnArgs>(args?: SelectSubset<T, TradeCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Trade.
     * @param {TradeDeleteArgs} args - Arguments to delete one Trade.
     * @example
     * // Delete one Trade
     * const Trade = await prisma.trade.delete({
     *   where: {
     *     // ... filter to delete one Trade
     *   }
     * })
     * 
     */
    delete<T extends TradeDeleteArgs>(args: SelectSubset<T, TradeDeleteArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Trade.
     * @param {TradeUpdateArgs} args - Arguments to update one Trade.
     * @example
     * // Update one Trade
     * const trade = await prisma.trade.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TradeUpdateArgs>(args: SelectSubset<T, TradeUpdateArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Trades.
     * @param {TradeDeleteManyArgs} args - Arguments to filter Trades to delete.
     * @example
     * // Delete a few Trades
     * const { count } = await prisma.trade.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TradeDeleteManyArgs>(args?: SelectSubset<T, TradeDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Trades.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Trades
     * const trade = await prisma.trade.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TradeUpdateManyArgs>(args: SelectSubset<T, TradeUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Trades and returns the data updated in the database.
     * @param {TradeUpdateManyAndReturnArgs} args - Arguments to update many Trades.
     * @example
     * // Update many Trades
     * const trade = await prisma.trade.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Trades and only return the `id`
     * const tradeWithIdOnly = await prisma.trade.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends TradeUpdateManyAndReturnArgs>(args: SelectSubset<T, TradeUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Trade.
     * @param {TradeUpsertArgs} args - Arguments to update or create a Trade.
     * @example
     * // Update or create a Trade
     * const trade = await prisma.trade.upsert({
     *   create: {
     *     // ... data to create a Trade
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Trade we want to update
     *   }
     * })
     */
    upsert<T extends TradeUpsertArgs>(args: SelectSubset<T, TradeUpsertArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Trades.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeCountArgs} args - Arguments to filter Trades to count.
     * @example
     * // Count the number of Trades
     * const count = await prisma.trade.count({
     *   where: {
     *     // ... the filter for the Trades we want to count
     *   }
     * })
    **/
    count<T extends TradeCountArgs>(
      args?: Subset<T, TradeCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TradeCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Trade.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TradeAggregateArgs>(args: Subset<T, TradeAggregateArgs>): Prisma.PrismaPromise<GetTradeAggregateType<T>>

    /**
     * Group by Trade.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TradeGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TradeGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TradeGroupByArgs['orderBy'] }
        : { orderBy?: TradeGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TradeGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTradeGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Trade model
   */
  readonly fields: TradeFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Trade.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TradeClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    market<T extends MarketDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MarketDefaultArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    position<T extends Trade$positionArgs<ExtArgs> = {}>(args?: Subset<T, Trade$positionArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    copyTrades<T extends Trade$copyTradesArgs<ExtArgs> = {}>(args?: Subset<T, Trade$copyTradesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Trade model
   */
  interface TradeFieldRefs {
    readonly id: FieldRef<"Trade", 'String'>
    readonly marketId: FieldRef<"Trade", 'String'>
    readonly direction: FieldRef<"Trade", 'TradeDirection'>
    readonly status: FieldRef<"Trade", 'TradeStatus'>
    readonly amount: FieldRef<"Trade", 'Float'>
    readonly price: FieldRef<"Trade", 'Float'>
    readonly edgeDetected: FieldRef<"Trade", 'Float'>
    readonly kellyFraction: FieldRef<"Trade", 'Float'>
    readonly txHash: FieldRef<"Trade", 'String'>
    readonly builderFee: FieldRef<"Trade", 'Float'>
    readonly errorMessage: FieldRef<"Trade", 'String'>
    readonly executedAt: FieldRef<"Trade", 'DateTime'>
    readonly createdAt: FieldRef<"Trade", 'DateTime'>
    readonly updatedAt: FieldRef<"Trade", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Trade findUnique
   */
  export type TradeFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter, which Trade to fetch.
     */
    where: TradeWhereUniqueInput
  }

  /**
   * Trade findUniqueOrThrow
   */
  export type TradeFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter, which Trade to fetch.
     */
    where: TradeWhereUniqueInput
  }

  /**
   * Trade findFirst
   */
  export type TradeFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter, which Trade to fetch.
     */
    where?: TradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Trades to fetch.
     */
    orderBy?: TradeOrderByWithRelationInput | TradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Trades.
     */
    cursor?: TradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Trades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Trades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Trades.
     */
    distinct?: TradeScalarFieldEnum | TradeScalarFieldEnum[]
  }

  /**
   * Trade findFirstOrThrow
   */
  export type TradeFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter, which Trade to fetch.
     */
    where?: TradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Trades to fetch.
     */
    orderBy?: TradeOrderByWithRelationInput | TradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Trades.
     */
    cursor?: TradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Trades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Trades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Trades.
     */
    distinct?: TradeScalarFieldEnum | TradeScalarFieldEnum[]
  }

  /**
   * Trade findMany
   */
  export type TradeFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter, which Trades to fetch.
     */
    where?: TradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Trades to fetch.
     */
    orderBy?: TradeOrderByWithRelationInput | TradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Trades.
     */
    cursor?: TradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Trades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Trades.
     */
    skip?: number
    distinct?: TradeScalarFieldEnum | TradeScalarFieldEnum[]
  }

  /**
   * Trade create
   */
  export type TradeCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * The data needed to create a Trade.
     */
    data: XOR<TradeCreateInput, TradeUncheckedCreateInput>
  }

  /**
   * Trade createMany
   */
  export type TradeCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Trades.
     */
    data: TradeCreateManyInput | TradeCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Trade createManyAndReturn
   */
  export type TradeCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * The data used to create many Trades.
     */
    data: TradeCreateManyInput | TradeCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Trade update
   */
  export type TradeUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * The data needed to update a Trade.
     */
    data: XOR<TradeUpdateInput, TradeUncheckedUpdateInput>
    /**
     * Choose, which Trade to update.
     */
    where: TradeWhereUniqueInput
  }

  /**
   * Trade updateMany
   */
  export type TradeUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Trades.
     */
    data: XOR<TradeUpdateManyMutationInput, TradeUncheckedUpdateManyInput>
    /**
     * Filter which Trades to update
     */
    where?: TradeWhereInput
    /**
     * Limit how many Trades to update.
     */
    limit?: number
  }

  /**
   * Trade updateManyAndReturn
   */
  export type TradeUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * The data used to update Trades.
     */
    data: XOR<TradeUpdateManyMutationInput, TradeUncheckedUpdateManyInput>
    /**
     * Filter which Trades to update
     */
    where?: TradeWhereInput
    /**
     * Limit how many Trades to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Trade upsert
   */
  export type TradeUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * The filter to search for the Trade to update in case it exists.
     */
    where: TradeWhereUniqueInput
    /**
     * In case the Trade found by the `where` argument doesn't exist, create a new Trade with this data.
     */
    create: XOR<TradeCreateInput, TradeUncheckedCreateInput>
    /**
     * In case the Trade was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TradeUpdateInput, TradeUncheckedUpdateInput>
  }

  /**
   * Trade delete
   */
  export type TradeDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    /**
     * Filter which Trade to delete.
     */
    where: TradeWhereUniqueInput
  }

  /**
   * Trade deleteMany
   */
  export type TradeDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Trades to delete
     */
    where?: TradeWhereInput
    /**
     * Limit how many Trades to delete.
     */
    limit?: number
  }

  /**
   * Trade.position
   */
  export type Trade$positionArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    where?: PositionWhereInput
  }

  /**
   * Trade.copyTrades
   */
  export type Trade$copyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    where?: CopyTradeWhereInput
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    cursor?: CopyTradeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * Trade without action
   */
  export type TradeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
  }


  /**
   * Model Position
   */

  export type AggregatePosition = {
    _count: PositionCountAggregateOutputType | null
    _avg: PositionAvgAggregateOutputType | null
    _sum: PositionSumAggregateOutputType | null
    _min: PositionMinAggregateOutputType | null
    _max: PositionMaxAggregateOutputType | null
  }

  export type PositionAvgAggregateOutputType = {
    entryPrice: number | null
    currentPrice: number | null
    size: number | null
    pnl: number | null
  }

  export type PositionSumAggregateOutputType = {
    entryPrice: number | null
    currentPrice: number | null
    size: number | null
    pnl: number | null
  }

  export type PositionMinAggregateOutputType = {
    id: string | null
    marketId: string | null
    tradeId: string | null
    direction: $Enums.TradeDirection | null
    status: $Enums.PositionStatus | null
    entryPrice: number | null
    currentPrice: number | null
    size: number | null
    pnl: number | null
    hedgeMarketId: string | null
    closedAt: Date | null
    closeReason: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PositionMaxAggregateOutputType = {
    id: string | null
    marketId: string | null
    tradeId: string | null
    direction: $Enums.TradeDirection | null
    status: $Enums.PositionStatus | null
    entryPrice: number | null
    currentPrice: number | null
    size: number | null
    pnl: number | null
    hedgeMarketId: string | null
    closedAt: Date | null
    closeReason: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type PositionCountAggregateOutputType = {
    id: number
    marketId: number
    tradeId: number
    direction: number
    status: number
    entryPrice: number
    currentPrice: number
    size: number
    pnl: number
    hedgeMarketId: number
    closedAt: number
    closeReason: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type PositionAvgAggregateInputType = {
    entryPrice?: true
    currentPrice?: true
    size?: true
    pnl?: true
  }

  export type PositionSumAggregateInputType = {
    entryPrice?: true
    currentPrice?: true
    size?: true
    pnl?: true
  }

  export type PositionMinAggregateInputType = {
    id?: true
    marketId?: true
    tradeId?: true
    direction?: true
    status?: true
    entryPrice?: true
    currentPrice?: true
    size?: true
    pnl?: true
    hedgeMarketId?: true
    closedAt?: true
    closeReason?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PositionMaxAggregateInputType = {
    id?: true
    marketId?: true
    tradeId?: true
    direction?: true
    status?: true
    entryPrice?: true
    currentPrice?: true
    size?: true
    pnl?: true
    hedgeMarketId?: true
    closedAt?: true
    closeReason?: true
    createdAt?: true
    updatedAt?: true
  }

  export type PositionCountAggregateInputType = {
    id?: true
    marketId?: true
    tradeId?: true
    direction?: true
    status?: true
    entryPrice?: true
    currentPrice?: true
    size?: true
    pnl?: true
    hedgeMarketId?: true
    closedAt?: true
    closeReason?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type PositionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Position to aggregate.
     */
    where?: PositionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Positions to fetch.
     */
    orderBy?: PositionOrderByWithRelationInput | PositionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PositionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Positions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Positions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Positions
    **/
    _count?: true | PositionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: PositionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: PositionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PositionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PositionMaxAggregateInputType
  }

  export type GetPositionAggregateType<T extends PositionAggregateArgs> = {
        [P in keyof T & keyof AggregatePosition]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePosition[P]>
      : GetScalarType<T[P], AggregatePosition[P]>
  }




  export type PositionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PositionWhereInput
    orderBy?: PositionOrderByWithAggregationInput | PositionOrderByWithAggregationInput[]
    by: PositionScalarFieldEnum[] | PositionScalarFieldEnum
    having?: PositionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PositionCountAggregateInputType | true
    _avg?: PositionAvgAggregateInputType
    _sum?: PositionSumAggregateInputType
    _min?: PositionMinAggregateInputType
    _max?: PositionMaxAggregateInputType
  }

  export type PositionGroupByOutputType = {
    id: string
    marketId: string
    tradeId: string
    direction: $Enums.TradeDirection
    status: $Enums.PositionStatus
    entryPrice: number
    currentPrice: number | null
    size: number
    pnl: number
    hedgeMarketId: string | null
    closedAt: Date | null
    closeReason: string | null
    createdAt: Date
    updatedAt: Date
    _count: PositionCountAggregateOutputType | null
    _avg: PositionAvgAggregateOutputType | null
    _sum: PositionSumAggregateOutputType | null
    _min: PositionMinAggregateOutputType | null
    _max: PositionMaxAggregateOutputType | null
  }

  type GetPositionGroupByPayload<T extends PositionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PositionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PositionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PositionGroupByOutputType[P]>
            : GetScalarType<T[P], PositionGroupByOutputType[P]>
        }
      >
    >


  export type PositionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    status?: boolean
    entryPrice?: boolean
    currentPrice?: boolean
    size?: boolean
    pnl?: boolean
    hedgeMarketId?: boolean
    closedAt?: boolean
    closeReason?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["position"]>

  export type PositionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    status?: boolean
    entryPrice?: boolean
    currentPrice?: boolean
    size?: boolean
    pnl?: boolean
    hedgeMarketId?: boolean
    closedAt?: boolean
    closeReason?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["position"]>

  export type PositionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    status?: boolean
    entryPrice?: boolean
    currentPrice?: boolean
    size?: boolean
    pnl?: boolean
    hedgeMarketId?: boolean
    closedAt?: boolean
    closeReason?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["position"]>

  export type PositionSelectScalar = {
    id?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    status?: boolean
    entryPrice?: boolean
    currentPrice?: boolean
    size?: boolean
    pnl?: boolean
    hedgeMarketId?: boolean
    closedAt?: boolean
    closeReason?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type PositionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "marketId" | "tradeId" | "direction" | "status" | "entryPrice" | "currentPrice" | "size" | "pnl" | "hedgeMarketId" | "closedAt" | "closeReason" | "createdAt" | "updatedAt", ExtArgs["result"]["position"]>
  export type PositionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }
  export type PositionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }
  export type PositionIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | TradeDefaultArgs<ExtArgs>
  }

  export type $PositionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Position"
    objects: {
      market: Prisma.$MarketPayload<ExtArgs>
      trade: Prisma.$TradePayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      marketId: string
      tradeId: string
      direction: $Enums.TradeDirection
      status: $Enums.PositionStatus
      entryPrice: number
      currentPrice: number | null
      size: number
      pnl: number
      hedgeMarketId: string | null
      closedAt: Date | null
      closeReason: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["position"]>
    composites: {}
  }

  type PositionGetPayload<S extends boolean | null | undefined | PositionDefaultArgs> = $Result.GetResult<Prisma.$PositionPayload, S>

  type PositionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<PositionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: PositionCountAggregateInputType | true
    }

  export interface PositionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Position'], meta: { name: 'Position' } }
    /**
     * Find zero or one Position that matches the filter.
     * @param {PositionFindUniqueArgs} args - Arguments to find a Position
     * @example
     * // Get one Position
     * const position = await prisma.position.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends PositionFindUniqueArgs>(args: SelectSubset<T, PositionFindUniqueArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Position that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {PositionFindUniqueOrThrowArgs} args - Arguments to find a Position
     * @example
     * // Get one Position
     * const position = await prisma.position.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends PositionFindUniqueOrThrowArgs>(args: SelectSubset<T, PositionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Position that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionFindFirstArgs} args - Arguments to find a Position
     * @example
     * // Get one Position
     * const position = await prisma.position.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends PositionFindFirstArgs>(args?: SelectSubset<T, PositionFindFirstArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Position that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionFindFirstOrThrowArgs} args - Arguments to find a Position
     * @example
     * // Get one Position
     * const position = await prisma.position.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends PositionFindFirstOrThrowArgs>(args?: SelectSubset<T, PositionFindFirstOrThrowArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Positions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Positions
     * const positions = await prisma.position.findMany()
     * 
     * // Get first 10 Positions
     * const positions = await prisma.position.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const positionWithIdOnly = await prisma.position.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends PositionFindManyArgs>(args?: SelectSubset<T, PositionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Position.
     * @param {PositionCreateArgs} args - Arguments to create a Position.
     * @example
     * // Create one Position
     * const Position = await prisma.position.create({
     *   data: {
     *     // ... data to create a Position
     *   }
     * })
     * 
     */
    create<T extends PositionCreateArgs>(args: SelectSubset<T, PositionCreateArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Positions.
     * @param {PositionCreateManyArgs} args - Arguments to create many Positions.
     * @example
     * // Create many Positions
     * const position = await prisma.position.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends PositionCreateManyArgs>(args?: SelectSubset<T, PositionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Positions and returns the data saved in the database.
     * @param {PositionCreateManyAndReturnArgs} args - Arguments to create many Positions.
     * @example
     * // Create many Positions
     * const position = await prisma.position.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Positions and only return the `id`
     * const positionWithIdOnly = await prisma.position.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends PositionCreateManyAndReturnArgs>(args?: SelectSubset<T, PositionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Position.
     * @param {PositionDeleteArgs} args - Arguments to delete one Position.
     * @example
     * // Delete one Position
     * const Position = await prisma.position.delete({
     *   where: {
     *     // ... filter to delete one Position
     *   }
     * })
     * 
     */
    delete<T extends PositionDeleteArgs>(args: SelectSubset<T, PositionDeleteArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Position.
     * @param {PositionUpdateArgs} args - Arguments to update one Position.
     * @example
     * // Update one Position
     * const position = await prisma.position.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends PositionUpdateArgs>(args: SelectSubset<T, PositionUpdateArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Positions.
     * @param {PositionDeleteManyArgs} args - Arguments to filter Positions to delete.
     * @example
     * // Delete a few Positions
     * const { count } = await prisma.position.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends PositionDeleteManyArgs>(args?: SelectSubset<T, PositionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Positions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Positions
     * const position = await prisma.position.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends PositionUpdateManyArgs>(args: SelectSubset<T, PositionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Positions and returns the data updated in the database.
     * @param {PositionUpdateManyAndReturnArgs} args - Arguments to update many Positions.
     * @example
     * // Update many Positions
     * const position = await prisma.position.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Positions and only return the `id`
     * const positionWithIdOnly = await prisma.position.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends PositionUpdateManyAndReturnArgs>(args: SelectSubset<T, PositionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Position.
     * @param {PositionUpsertArgs} args - Arguments to update or create a Position.
     * @example
     * // Update or create a Position
     * const position = await prisma.position.upsert({
     *   create: {
     *     // ... data to create a Position
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Position we want to update
     *   }
     * })
     */
    upsert<T extends PositionUpsertArgs>(args: SelectSubset<T, PositionUpsertArgs<ExtArgs>>): Prisma__PositionClient<$Result.GetResult<Prisma.$PositionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Positions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionCountArgs} args - Arguments to filter Positions to count.
     * @example
     * // Count the number of Positions
     * const count = await prisma.position.count({
     *   where: {
     *     // ... the filter for the Positions we want to count
     *   }
     * })
    **/
    count<T extends PositionCountArgs>(
      args?: Subset<T, PositionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PositionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Position.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PositionAggregateArgs>(args: Subset<T, PositionAggregateArgs>): Prisma.PrismaPromise<GetPositionAggregateType<T>>

    /**
     * Group by Position.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PositionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PositionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PositionGroupByArgs['orderBy'] }
        : { orderBy?: PositionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PositionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPositionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Position model
   */
  readonly fields: PositionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Position.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PositionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    market<T extends MarketDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MarketDefaultArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    trade<T extends TradeDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TradeDefaultArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Position model
   */
  interface PositionFieldRefs {
    readonly id: FieldRef<"Position", 'String'>
    readonly marketId: FieldRef<"Position", 'String'>
    readonly tradeId: FieldRef<"Position", 'String'>
    readonly direction: FieldRef<"Position", 'TradeDirection'>
    readonly status: FieldRef<"Position", 'PositionStatus'>
    readonly entryPrice: FieldRef<"Position", 'Float'>
    readonly currentPrice: FieldRef<"Position", 'Float'>
    readonly size: FieldRef<"Position", 'Float'>
    readonly pnl: FieldRef<"Position", 'Float'>
    readonly hedgeMarketId: FieldRef<"Position", 'String'>
    readonly closedAt: FieldRef<"Position", 'DateTime'>
    readonly closeReason: FieldRef<"Position", 'String'>
    readonly createdAt: FieldRef<"Position", 'DateTime'>
    readonly updatedAt: FieldRef<"Position", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Position findUnique
   */
  export type PositionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter, which Position to fetch.
     */
    where: PositionWhereUniqueInput
  }

  /**
   * Position findUniqueOrThrow
   */
  export type PositionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter, which Position to fetch.
     */
    where: PositionWhereUniqueInput
  }

  /**
   * Position findFirst
   */
  export type PositionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter, which Position to fetch.
     */
    where?: PositionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Positions to fetch.
     */
    orderBy?: PositionOrderByWithRelationInput | PositionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Positions.
     */
    cursor?: PositionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Positions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Positions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Positions.
     */
    distinct?: PositionScalarFieldEnum | PositionScalarFieldEnum[]
  }

  /**
   * Position findFirstOrThrow
   */
  export type PositionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter, which Position to fetch.
     */
    where?: PositionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Positions to fetch.
     */
    orderBy?: PositionOrderByWithRelationInput | PositionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Positions.
     */
    cursor?: PositionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Positions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Positions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Positions.
     */
    distinct?: PositionScalarFieldEnum | PositionScalarFieldEnum[]
  }

  /**
   * Position findMany
   */
  export type PositionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter, which Positions to fetch.
     */
    where?: PositionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Positions to fetch.
     */
    orderBy?: PositionOrderByWithRelationInput | PositionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Positions.
     */
    cursor?: PositionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Positions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Positions.
     */
    skip?: number
    distinct?: PositionScalarFieldEnum | PositionScalarFieldEnum[]
  }

  /**
   * Position create
   */
  export type PositionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * The data needed to create a Position.
     */
    data: XOR<PositionCreateInput, PositionUncheckedCreateInput>
  }

  /**
   * Position createMany
   */
  export type PositionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Positions.
     */
    data: PositionCreateManyInput | PositionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Position createManyAndReturn
   */
  export type PositionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * The data used to create many Positions.
     */
    data: PositionCreateManyInput | PositionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Position update
   */
  export type PositionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * The data needed to update a Position.
     */
    data: XOR<PositionUpdateInput, PositionUncheckedUpdateInput>
    /**
     * Choose, which Position to update.
     */
    where: PositionWhereUniqueInput
  }

  /**
   * Position updateMany
   */
  export type PositionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Positions.
     */
    data: XOR<PositionUpdateManyMutationInput, PositionUncheckedUpdateManyInput>
    /**
     * Filter which Positions to update
     */
    where?: PositionWhereInput
    /**
     * Limit how many Positions to update.
     */
    limit?: number
  }

  /**
   * Position updateManyAndReturn
   */
  export type PositionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * The data used to update Positions.
     */
    data: XOR<PositionUpdateManyMutationInput, PositionUncheckedUpdateManyInput>
    /**
     * Filter which Positions to update
     */
    where?: PositionWhereInput
    /**
     * Limit how many Positions to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Position upsert
   */
  export type PositionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * The filter to search for the Position to update in case it exists.
     */
    where: PositionWhereUniqueInput
    /**
     * In case the Position found by the `where` argument doesn't exist, create a new Position with this data.
     */
    create: XOR<PositionCreateInput, PositionUncheckedCreateInput>
    /**
     * In case the Position was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PositionUpdateInput, PositionUncheckedUpdateInput>
  }

  /**
   * Position delete
   */
  export type PositionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
    /**
     * Filter which Position to delete.
     */
    where: PositionWhereUniqueInput
  }

  /**
   * Position deleteMany
   */
  export type PositionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Positions to delete
     */
    where?: PositionWhereInput
    /**
     * Limit how many Positions to delete.
     */
    limit?: number
  }

  /**
   * Position without action
   */
  export type PositionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Position
     */
    select?: PositionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Position
     */
    omit?: PositionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: PositionInclude<ExtArgs> | null
  }


  /**
   * Model ReasoningTrace
   */

  export type AggregateReasoningTrace = {
    _count: ReasoningTraceCountAggregateOutputType | null
    _avg: ReasoningTraceAvgAggregateOutputType | null
    _sum: ReasoningTraceSumAggregateOutputType | null
    _min: ReasoningTraceMinAggregateOutputType | null
    _max: ReasoningTraceMaxAggregateOutputType | null
  }

  export type ReasoningTraceAvgAggregateOutputType = {
    probabilityEstimate: number | null
    marketProbability: number | null
    edge: number | null
    betFraction: number | null
    betSizeUsdc: number | null
  }

  export type ReasoningTraceSumAggregateOutputType = {
    probabilityEstimate: number | null
    marketProbability: number | null
    edge: number | null
    betFraction: number | null
    betSizeUsdc: number | null
  }

  export type ReasoningTraceMinAggregateOutputType = {
    id: string | null
    marketId: string | null
    agentType: $Enums.AgentType | null
    decisionType: string | null
    probabilityEstimate: number | null
    marketProbability: number | null
    edge: number | null
    betFraction: number | null
    betSizeUsdc: number | null
    agentWallet: string | null
    signature: string | null
    ipfsCid: string | null
    sha256Hash: string | null
    onChainTxHash: string | null
    verified: boolean | null
    isPublic: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ReasoningTraceMaxAggregateOutputType = {
    id: string | null
    marketId: string | null
    agentType: $Enums.AgentType | null
    decisionType: string | null
    probabilityEstimate: number | null
    marketProbability: number | null
    edge: number | null
    betFraction: number | null
    betSizeUsdc: number | null
    agentWallet: string | null
    signature: string | null
    ipfsCid: string | null
    sha256Hash: string | null
    onChainTxHash: string | null
    verified: boolean | null
    isPublic: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ReasoningTraceCountAggregateOutputType = {
    id: number
    marketId: number
    agentType: number
    decisionType: number
    sourcesUsed: number
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: number
    betFraction: number
    betSizeUsdc: number
    hedgeConditions: number
    agentWallet: number
    signature: number
    ipfsCid: number
    sha256Hash: number
    onChainTxHash: number
    verified: number
    isPublic: number
    previewSources: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ReasoningTraceAvgAggregateInputType = {
    probabilityEstimate?: true
    marketProbability?: true
    edge?: true
    betFraction?: true
    betSizeUsdc?: true
  }

  export type ReasoningTraceSumAggregateInputType = {
    probabilityEstimate?: true
    marketProbability?: true
    edge?: true
    betFraction?: true
    betSizeUsdc?: true
  }

  export type ReasoningTraceMinAggregateInputType = {
    id?: true
    marketId?: true
    agentType?: true
    decisionType?: true
    probabilityEstimate?: true
    marketProbability?: true
    edge?: true
    betFraction?: true
    betSizeUsdc?: true
    agentWallet?: true
    signature?: true
    ipfsCid?: true
    sha256Hash?: true
    onChainTxHash?: true
    verified?: true
    isPublic?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ReasoningTraceMaxAggregateInputType = {
    id?: true
    marketId?: true
    agentType?: true
    decisionType?: true
    probabilityEstimate?: true
    marketProbability?: true
    edge?: true
    betFraction?: true
    betSizeUsdc?: true
    agentWallet?: true
    signature?: true
    ipfsCid?: true
    sha256Hash?: true
    onChainTxHash?: true
    verified?: true
    isPublic?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ReasoningTraceCountAggregateInputType = {
    id?: true
    marketId?: true
    agentType?: true
    decisionType?: true
    sourcesUsed?: true
    probabilityEstimate?: true
    marketProbability?: true
    edge?: true
    confidenceInterval?: true
    betFraction?: true
    betSizeUsdc?: true
    hedgeConditions?: true
    agentWallet?: true
    signature?: true
    ipfsCid?: true
    sha256Hash?: true
    onChainTxHash?: true
    verified?: true
    isPublic?: true
    previewSources?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ReasoningTraceAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ReasoningTrace to aggregate.
     */
    where?: ReasoningTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ReasoningTraces to fetch.
     */
    orderBy?: ReasoningTraceOrderByWithRelationInput | ReasoningTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ReasoningTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ReasoningTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ReasoningTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ReasoningTraces
    **/
    _count?: true | ReasoningTraceCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ReasoningTraceAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ReasoningTraceSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ReasoningTraceMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ReasoningTraceMaxAggregateInputType
  }

  export type GetReasoningTraceAggregateType<T extends ReasoningTraceAggregateArgs> = {
        [P in keyof T & keyof AggregateReasoningTrace]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateReasoningTrace[P]>
      : GetScalarType<T[P], AggregateReasoningTrace[P]>
  }




  export type ReasoningTraceGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ReasoningTraceWhereInput
    orderBy?: ReasoningTraceOrderByWithAggregationInput | ReasoningTraceOrderByWithAggregationInput[]
    by: ReasoningTraceScalarFieldEnum[] | ReasoningTraceScalarFieldEnum
    having?: ReasoningTraceScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ReasoningTraceCountAggregateInputType | true
    _avg?: ReasoningTraceAvgAggregateInputType
    _sum?: ReasoningTraceSumAggregateInputType
    _min?: ReasoningTraceMinAggregateInputType
    _max?: ReasoningTraceMaxAggregateInputType
  }

  export type ReasoningTraceGroupByOutputType = {
    id: string
    marketId: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonValue
    betFraction: number | null
    betSizeUsdc: number | null
    hedgeConditions: JsonValue | null
    agentWallet: string | null
    signature: string | null
    ipfsCid: string | null
    sha256Hash: string | null
    onChainTxHash: string | null
    verified: boolean
    isPublic: boolean
    previewSources: JsonValue | null
    createdAt: Date
    updatedAt: Date
    _count: ReasoningTraceCountAggregateOutputType | null
    _avg: ReasoningTraceAvgAggregateOutputType | null
    _sum: ReasoningTraceSumAggregateOutputType | null
    _min: ReasoningTraceMinAggregateOutputType | null
    _max: ReasoningTraceMaxAggregateOutputType | null
  }

  type GetReasoningTraceGroupByPayload<T extends ReasoningTraceGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ReasoningTraceGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ReasoningTraceGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ReasoningTraceGroupByOutputType[P]>
            : GetScalarType<T[P], ReasoningTraceGroupByOutputType[P]>
        }
      >
    >


  export type ReasoningTraceSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    agentType?: boolean
    decisionType?: boolean
    sourcesUsed?: boolean
    probabilityEstimate?: boolean
    marketProbability?: boolean
    edge?: boolean
    confidenceInterval?: boolean
    betFraction?: boolean
    betSizeUsdc?: boolean
    hedgeConditions?: boolean
    agentWallet?: boolean
    signature?: boolean
    ipfsCid?: boolean
    sha256Hash?: boolean
    onChainTxHash?: boolean
    verified?: boolean
    isPublic?: boolean
    previewSources?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
    copyTrades?: boolean | ReasoningTrace$copyTradesArgs<ExtArgs>
    subscriptions?: boolean | ReasoningTrace$subscriptionsArgs<ExtArgs>
    _count?: boolean | ReasoningTraceCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["reasoningTrace"]>

  export type ReasoningTraceSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    agentType?: boolean
    decisionType?: boolean
    sourcesUsed?: boolean
    probabilityEstimate?: boolean
    marketProbability?: boolean
    edge?: boolean
    confidenceInterval?: boolean
    betFraction?: boolean
    betSizeUsdc?: boolean
    hedgeConditions?: boolean
    agentWallet?: boolean
    signature?: boolean
    ipfsCid?: boolean
    sha256Hash?: boolean
    onChainTxHash?: boolean
    verified?: boolean
    isPublic?: boolean
    previewSources?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["reasoningTrace"]>

  export type ReasoningTraceSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    marketId?: boolean
    agentType?: boolean
    decisionType?: boolean
    sourcesUsed?: boolean
    probabilityEstimate?: boolean
    marketProbability?: boolean
    edge?: boolean
    confidenceInterval?: boolean
    betFraction?: boolean
    betSizeUsdc?: boolean
    hedgeConditions?: boolean
    agentWallet?: boolean
    signature?: boolean
    ipfsCid?: boolean
    sha256Hash?: boolean
    onChainTxHash?: boolean
    verified?: boolean
    isPublic?: boolean
    previewSources?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["reasoningTrace"]>

  export type ReasoningTraceSelectScalar = {
    id?: boolean
    marketId?: boolean
    agentType?: boolean
    decisionType?: boolean
    sourcesUsed?: boolean
    probabilityEstimate?: boolean
    marketProbability?: boolean
    edge?: boolean
    confidenceInterval?: boolean
    betFraction?: boolean
    betSizeUsdc?: boolean
    hedgeConditions?: boolean
    agentWallet?: boolean
    signature?: boolean
    ipfsCid?: boolean
    sha256Hash?: boolean
    onChainTxHash?: boolean
    verified?: boolean
    isPublic?: boolean
    previewSources?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ReasoningTraceOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "marketId" | "agentType" | "decisionType" | "sourcesUsed" | "probabilityEstimate" | "marketProbability" | "edge" | "confidenceInterval" | "betFraction" | "betSizeUsdc" | "hedgeConditions" | "agentWallet" | "signature" | "ipfsCid" | "sha256Hash" | "onChainTxHash" | "verified" | "isPublic" | "previewSources" | "createdAt" | "updatedAt", ExtArgs["result"]["reasoningTrace"]>
  export type ReasoningTraceInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
    copyTrades?: boolean | ReasoningTrace$copyTradesArgs<ExtArgs>
    subscriptions?: boolean | ReasoningTrace$subscriptionsArgs<ExtArgs>
    _count?: boolean | ReasoningTraceCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type ReasoningTraceIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }
  export type ReasoningTraceIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | MarketDefaultArgs<ExtArgs>
  }

  export type $ReasoningTracePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ReasoningTrace"
    objects: {
      market: Prisma.$MarketPayload<ExtArgs>
      copyTrades: Prisma.$CopyTradePayload<ExtArgs>[]
      subscriptions: Prisma.$SubscriptionPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      marketId: string
      agentType: $Enums.AgentType
      decisionType: string
      sourcesUsed: Prisma.JsonValue
      probabilityEstimate: number
      marketProbability: number
      edge: number
      confidenceInterval: Prisma.JsonValue
      betFraction: number | null
      betSizeUsdc: number | null
      hedgeConditions: Prisma.JsonValue | null
      agentWallet: string | null
      signature: string | null
      ipfsCid: string | null
      sha256Hash: string | null
      onChainTxHash: string | null
      verified: boolean
      isPublic: boolean
      previewSources: Prisma.JsonValue | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["reasoningTrace"]>
    composites: {}
  }

  type ReasoningTraceGetPayload<S extends boolean | null | undefined | ReasoningTraceDefaultArgs> = $Result.GetResult<Prisma.$ReasoningTracePayload, S>

  type ReasoningTraceCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<ReasoningTraceFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: ReasoningTraceCountAggregateInputType | true
    }

  export interface ReasoningTraceDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ReasoningTrace'], meta: { name: 'ReasoningTrace' } }
    /**
     * Find zero or one ReasoningTrace that matches the filter.
     * @param {ReasoningTraceFindUniqueArgs} args - Arguments to find a ReasoningTrace
     * @example
     * // Get one ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ReasoningTraceFindUniqueArgs>(args: SelectSubset<T, ReasoningTraceFindUniqueArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one ReasoningTrace that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {ReasoningTraceFindUniqueOrThrowArgs} args - Arguments to find a ReasoningTrace
     * @example
     * // Get one ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ReasoningTraceFindUniqueOrThrowArgs>(args: SelectSubset<T, ReasoningTraceFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ReasoningTrace that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceFindFirstArgs} args - Arguments to find a ReasoningTrace
     * @example
     * // Get one ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ReasoningTraceFindFirstArgs>(args?: SelectSubset<T, ReasoningTraceFindFirstArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ReasoningTrace that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceFindFirstOrThrowArgs} args - Arguments to find a ReasoningTrace
     * @example
     * // Get one ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ReasoningTraceFindFirstOrThrowArgs>(args?: SelectSubset<T, ReasoningTraceFindFirstOrThrowArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more ReasoningTraces that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ReasoningTraces
     * const reasoningTraces = await prisma.reasoningTrace.findMany()
     * 
     * // Get first 10 ReasoningTraces
     * const reasoningTraces = await prisma.reasoningTrace.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const reasoningTraceWithIdOnly = await prisma.reasoningTrace.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ReasoningTraceFindManyArgs>(args?: SelectSubset<T, ReasoningTraceFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a ReasoningTrace.
     * @param {ReasoningTraceCreateArgs} args - Arguments to create a ReasoningTrace.
     * @example
     * // Create one ReasoningTrace
     * const ReasoningTrace = await prisma.reasoningTrace.create({
     *   data: {
     *     // ... data to create a ReasoningTrace
     *   }
     * })
     * 
     */
    create<T extends ReasoningTraceCreateArgs>(args: SelectSubset<T, ReasoningTraceCreateArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many ReasoningTraces.
     * @param {ReasoningTraceCreateManyArgs} args - Arguments to create many ReasoningTraces.
     * @example
     * // Create many ReasoningTraces
     * const reasoningTrace = await prisma.reasoningTrace.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ReasoningTraceCreateManyArgs>(args?: SelectSubset<T, ReasoningTraceCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ReasoningTraces and returns the data saved in the database.
     * @param {ReasoningTraceCreateManyAndReturnArgs} args - Arguments to create many ReasoningTraces.
     * @example
     * // Create many ReasoningTraces
     * const reasoningTrace = await prisma.reasoningTrace.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ReasoningTraces and only return the `id`
     * const reasoningTraceWithIdOnly = await prisma.reasoningTrace.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ReasoningTraceCreateManyAndReturnArgs>(args?: SelectSubset<T, ReasoningTraceCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a ReasoningTrace.
     * @param {ReasoningTraceDeleteArgs} args - Arguments to delete one ReasoningTrace.
     * @example
     * // Delete one ReasoningTrace
     * const ReasoningTrace = await prisma.reasoningTrace.delete({
     *   where: {
     *     // ... filter to delete one ReasoningTrace
     *   }
     * })
     * 
     */
    delete<T extends ReasoningTraceDeleteArgs>(args: SelectSubset<T, ReasoningTraceDeleteArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one ReasoningTrace.
     * @param {ReasoningTraceUpdateArgs} args - Arguments to update one ReasoningTrace.
     * @example
     * // Update one ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ReasoningTraceUpdateArgs>(args: SelectSubset<T, ReasoningTraceUpdateArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more ReasoningTraces.
     * @param {ReasoningTraceDeleteManyArgs} args - Arguments to filter ReasoningTraces to delete.
     * @example
     * // Delete a few ReasoningTraces
     * const { count } = await prisma.reasoningTrace.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ReasoningTraceDeleteManyArgs>(args?: SelectSubset<T, ReasoningTraceDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ReasoningTraces.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ReasoningTraces
     * const reasoningTrace = await prisma.reasoningTrace.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ReasoningTraceUpdateManyArgs>(args: SelectSubset<T, ReasoningTraceUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ReasoningTraces and returns the data updated in the database.
     * @param {ReasoningTraceUpdateManyAndReturnArgs} args - Arguments to update many ReasoningTraces.
     * @example
     * // Update many ReasoningTraces
     * const reasoningTrace = await prisma.reasoningTrace.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more ReasoningTraces and only return the `id`
     * const reasoningTraceWithIdOnly = await prisma.reasoningTrace.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends ReasoningTraceUpdateManyAndReturnArgs>(args: SelectSubset<T, ReasoningTraceUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one ReasoningTrace.
     * @param {ReasoningTraceUpsertArgs} args - Arguments to update or create a ReasoningTrace.
     * @example
     * // Update or create a ReasoningTrace
     * const reasoningTrace = await prisma.reasoningTrace.upsert({
     *   create: {
     *     // ... data to create a ReasoningTrace
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ReasoningTrace we want to update
     *   }
     * })
     */
    upsert<T extends ReasoningTraceUpsertArgs>(args: SelectSubset<T, ReasoningTraceUpsertArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of ReasoningTraces.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceCountArgs} args - Arguments to filter ReasoningTraces to count.
     * @example
     * // Count the number of ReasoningTraces
     * const count = await prisma.reasoningTrace.count({
     *   where: {
     *     // ... the filter for the ReasoningTraces we want to count
     *   }
     * })
    **/
    count<T extends ReasoningTraceCountArgs>(
      args?: Subset<T, ReasoningTraceCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ReasoningTraceCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ReasoningTrace.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ReasoningTraceAggregateArgs>(args: Subset<T, ReasoningTraceAggregateArgs>): Prisma.PrismaPromise<GetReasoningTraceAggregateType<T>>

    /**
     * Group by ReasoningTrace.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ReasoningTraceGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ReasoningTraceGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ReasoningTraceGroupByArgs['orderBy'] }
        : { orderBy?: ReasoningTraceGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ReasoningTraceGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetReasoningTraceGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ReasoningTrace model
   */
  readonly fields: ReasoningTraceFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ReasoningTrace.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ReasoningTraceClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    market<T extends MarketDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MarketDefaultArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    copyTrades<T extends ReasoningTrace$copyTradesArgs<ExtArgs> = {}>(args?: Subset<T, ReasoningTrace$copyTradesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    subscriptions<T extends ReasoningTrace$subscriptionsArgs<ExtArgs> = {}>(args?: Subset<T, ReasoningTrace$subscriptionsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the ReasoningTrace model
   */
  interface ReasoningTraceFieldRefs {
    readonly id: FieldRef<"ReasoningTrace", 'String'>
    readonly marketId: FieldRef<"ReasoningTrace", 'String'>
    readonly agentType: FieldRef<"ReasoningTrace", 'AgentType'>
    readonly decisionType: FieldRef<"ReasoningTrace", 'String'>
    readonly sourcesUsed: FieldRef<"ReasoningTrace", 'Json'>
    readonly probabilityEstimate: FieldRef<"ReasoningTrace", 'Float'>
    readonly marketProbability: FieldRef<"ReasoningTrace", 'Float'>
    readonly edge: FieldRef<"ReasoningTrace", 'Float'>
    readonly confidenceInterval: FieldRef<"ReasoningTrace", 'Json'>
    readonly betFraction: FieldRef<"ReasoningTrace", 'Float'>
    readonly betSizeUsdc: FieldRef<"ReasoningTrace", 'Float'>
    readonly hedgeConditions: FieldRef<"ReasoningTrace", 'Json'>
    readonly agentWallet: FieldRef<"ReasoningTrace", 'String'>
    readonly signature: FieldRef<"ReasoningTrace", 'String'>
    readonly ipfsCid: FieldRef<"ReasoningTrace", 'String'>
    readonly sha256Hash: FieldRef<"ReasoningTrace", 'String'>
    readonly onChainTxHash: FieldRef<"ReasoningTrace", 'String'>
    readonly verified: FieldRef<"ReasoningTrace", 'Boolean'>
    readonly isPublic: FieldRef<"ReasoningTrace", 'Boolean'>
    readonly previewSources: FieldRef<"ReasoningTrace", 'Json'>
    readonly createdAt: FieldRef<"ReasoningTrace", 'DateTime'>
    readonly updatedAt: FieldRef<"ReasoningTrace", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ReasoningTrace findUnique
   */
  export type ReasoningTraceFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter, which ReasoningTrace to fetch.
     */
    where: ReasoningTraceWhereUniqueInput
  }

  /**
   * ReasoningTrace findUniqueOrThrow
   */
  export type ReasoningTraceFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter, which ReasoningTrace to fetch.
     */
    where: ReasoningTraceWhereUniqueInput
  }

  /**
   * ReasoningTrace findFirst
   */
  export type ReasoningTraceFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter, which ReasoningTrace to fetch.
     */
    where?: ReasoningTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ReasoningTraces to fetch.
     */
    orderBy?: ReasoningTraceOrderByWithRelationInput | ReasoningTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ReasoningTraces.
     */
    cursor?: ReasoningTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ReasoningTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ReasoningTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ReasoningTraces.
     */
    distinct?: ReasoningTraceScalarFieldEnum | ReasoningTraceScalarFieldEnum[]
  }

  /**
   * ReasoningTrace findFirstOrThrow
   */
  export type ReasoningTraceFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter, which ReasoningTrace to fetch.
     */
    where?: ReasoningTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ReasoningTraces to fetch.
     */
    orderBy?: ReasoningTraceOrderByWithRelationInput | ReasoningTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ReasoningTraces.
     */
    cursor?: ReasoningTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ReasoningTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ReasoningTraces.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ReasoningTraces.
     */
    distinct?: ReasoningTraceScalarFieldEnum | ReasoningTraceScalarFieldEnum[]
  }

  /**
   * ReasoningTrace findMany
   */
  export type ReasoningTraceFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter, which ReasoningTraces to fetch.
     */
    where?: ReasoningTraceWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ReasoningTraces to fetch.
     */
    orderBy?: ReasoningTraceOrderByWithRelationInput | ReasoningTraceOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ReasoningTraces.
     */
    cursor?: ReasoningTraceWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ReasoningTraces from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ReasoningTraces.
     */
    skip?: number
    distinct?: ReasoningTraceScalarFieldEnum | ReasoningTraceScalarFieldEnum[]
  }

  /**
   * ReasoningTrace create
   */
  export type ReasoningTraceCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * The data needed to create a ReasoningTrace.
     */
    data: XOR<ReasoningTraceCreateInput, ReasoningTraceUncheckedCreateInput>
  }

  /**
   * ReasoningTrace createMany
   */
  export type ReasoningTraceCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ReasoningTraces.
     */
    data: ReasoningTraceCreateManyInput | ReasoningTraceCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ReasoningTrace createManyAndReturn
   */
  export type ReasoningTraceCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * The data used to create many ReasoningTraces.
     */
    data: ReasoningTraceCreateManyInput | ReasoningTraceCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * ReasoningTrace update
   */
  export type ReasoningTraceUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * The data needed to update a ReasoningTrace.
     */
    data: XOR<ReasoningTraceUpdateInput, ReasoningTraceUncheckedUpdateInput>
    /**
     * Choose, which ReasoningTrace to update.
     */
    where: ReasoningTraceWhereUniqueInput
  }

  /**
   * ReasoningTrace updateMany
   */
  export type ReasoningTraceUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ReasoningTraces.
     */
    data: XOR<ReasoningTraceUpdateManyMutationInput, ReasoningTraceUncheckedUpdateManyInput>
    /**
     * Filter which ReasoningTraces to update
     */
    where?: ReasoningTraceWhereInput
    /**
     * Limit how many ReasoningTraces to update.
     */
    limit?: number
  }

  /**
   * ReasoningTrace updateManyAndReturn
   */
  export type ReasoningTraceUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * The data used to update ReasoningTraces.
     */
    data: XOR<ReasoningTraceUpdateManyMutationInput, ReasoningTraceUncheckedUpdateManyInput>
    /**
     * Filter which ReasoningTraces to update
     */
    where?: ReasoningTraceWhereInput
    /**
     * Limit how many ReasoningTraces to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * ReasoningTrace upsert
   */
  export type ReasoningTraceUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * The filter to search for the ReasoningTrace to update in case it exists.
     */
    where: ReasoningTraceWhereUniqueInput
    /**
     * In case the ReasoningTrace found by the `where` argument doesn't exist, create a new ReasoningTrace with this data.
     */
    create: XOR<ReasoningTraceCreateInput, ReasoningTraceUncheckedCreateInput>
    /**
     * In case the ReasoningTrace was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ReasoningTraceUpdateInput, ReasoningTraceUncheckedUpdateInput>
  }

  /**
   * ReasoningTrace delete
   */
  export type ReasoningTraceDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    /**
     * Filter which ReasoningTrace to delete.
     */
    where: ReasoningTraceWhereUniqueInput
  }

  /**
   * ReasoningTrace deleteMany
   */
  export type ReasoningTraceDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ReasoningTraces to delete
     */
    where?: ReasoningTraceWhereInput
    /**
     * Limit how many ReasoningTraces to delete.
     */
    limit?: number
  }

  /**
   * ReasoningTrace.copyTrades
   */
  export type ReasoningTrace$copyTradesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    where?: CopyTradeWhereInput
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    cursor?: CopyTradeWhereUniqueInput
    take?: number
    skip?: number
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * ReasoningTrace.subscriptions
   */
  export type ReasoningTrace$subscriptionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    cursor?: SubscriptionWhereUniqueInput
    take?: number
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * ReasoningTrace without action
   */
  export type ReasoningTraceDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
  }


  /**
   * Model CopyTrade
   */

  export type AggregateCopyTrade = {
    _count: CopyTradeCountAggregateOutputType | null
    _avg: CopyTradeAvgAggregateOutputType | null
    _sum: CopyTradeSumAggregateOutputType | null
    _min: CopyTradeMinAggregateOutputType | null
    _max: CopyTradeMaxAggregateOutputType | null
  }

  export type CopyTradeAvgAggregateOutputType = {
    amount: number | null
    builderFee: number | null
    pnl: number | null
  }

  export type CopyTradeSumAggregateOutputType = {
    amount: number | null
    builderFee: number | null
    pnl: number | null
  }

  export type CopyTradeMinAggregateOutputType = {
    id: string | null
    userId: string | null
    traceId: string | null
    marketId: string | null
    tradeId: string | null
    direction: $Enums.TradeDirection | null
    amount: number | null
    txHash: string | null
    builderFee: number | null
    status: $Enums.TradeStatus | null
    pnl: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type CopyTradeMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    traceId: string | null
    marketId: string | null
    tradeId: string | null
    direction: $Enums.TradeDirection | null
    amount: number | null
    txHash: string | null
    builderFee: number | null
    status: $Enums.TradeStatus | null
    pnl: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type CopyTradeCountAggregateOutputType = {
    id: number
    userId: number
    traceId: number
    marketId: number
    tradeId: number
    direction: number
    amount: number
    txHash: number
    builderFee: number
    status: number
    pnl: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type CopyTradeAvgAggregateInputType = {
    amount?: true
    builderFee?: true
    pnl?: true
  }

  export type CopyTradeSumAggregateInputType = {
    amount?: true
    builderFee?: true
    pnl?: true
  }

  export type CopyTradeMinAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    marketId?: true
    tradeId?: true
    direction?: true
    amount?: true
    txHash?: true
    builderFee?: true
    status?: true
    pnl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type CopyTradeMaxAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    marketId?: true
    tradeId?: true
    direction?: true
    amount?: true
    txHash?: true
    builderFee?: true
    status?: true
    pnl?: true
    createdAt?: true
    updatedAt?: true
  }

  export type CopyTradeCountAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    marketId?: true
    tradeId?: true
    direction?: true
    amount?: true
    txHash?: true
    builderFee?: true
    status?: true
    pnl?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type CopyTradeAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CopyTrade to aggregate.
     */
    where?: CopyTradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CopyTrades to fetch.
     */
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: CopyTradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CopyTrades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CopyTrades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned CopyTrades
    **/
    _count?: true | CopyTradeCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: CopyTradeAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: CopyTradeSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CopyTradeMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CopyTradeMaxAggregateInputType
  }

  export type GetCopyTradeAggregateType<T extends CopyTradeAggregateArgs> = {
        [P in keyof T & keyof AggregateCopyTrade]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateCopyTrade[P]>
      : GetScalarType<T[P], AggregateCopyTrade[P]>
  }




  export type CopyTradeGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: CopyTradeWhereInput
    orderBy?: CopyTradeOrderByWithAggregationInput | CopyTradeOrderByWithAggregationInput[]
    by: CopyTradeScalarFieldEnum[] | CopyTradeScalarFieldEnum
    having?: CopyTradeScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CopyTradeCountAggregateInputType | true
    _avg?: CopyTradeAvgAggregateInputType
    _sum?: CopyTradeSumAggregateInputType
    _min?: CopyTradeMinAggregateInputType
    _max?: CopyTradeMaxAggregateInputType
  }

  export type CopyTradeGroupByOutputType = {
    id: string
    userId: string
    traceId: string
    marketId: string
    tradeId: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash: string | null
    builderFee: number
    status: $Enums.TradeStatus
    pnl: number | null
    createdAt: Date
    updatedAt: Date
    _count: CopyTradeCountAggregateOutputType | null
    _avg: CopyTradeAvgAggregateOutputType | null
    _sum: CopyTradeSumAggregateOutputType | null
    _min: CopyTradeMinAggregateOutputType | null
    _max: CopyTradeMaxAggregateOutputType | null
  }

  type GetCopyTradeGroupByPayload<T extends CopyTradeGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<CopyTradeGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CopyTradeGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CopyTradeGroupByOutputType[P]>
            : GetScalarType<T[P], CopyTradeGroupByOutputType[P]>
        }
      >
    >


  export type CopyTradeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    amount?: boolean
    txHash?: boolean
    builderFee?: boolean
    status?: boolean
    pnl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }, ExtArgs["result"]["copyTrade"]>

  export type CopyTradeSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    amount?: boolean
    txHash?: boolean
    builderFee?: boolean
    status?: boolean
    pnl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }, ExtArgs["result"]["copyTrade"]>

  export type CopyTradeSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    amount?: boolean
    txHash?: boolean
    builderFee?: boolean
    status?: boolean
    pnl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }, ExtArgs["result"]["copyTrade"]>

  export type CopyTradeSelectScalar = {
    id?: boolean
    userId?: boolean
    traceId?: boolean
    marketId?: boolean
    tradeId?: boolean
    direction?: boolean
    amount?: boolean
    txHash?: boolean
    builderFee?: boolean
    status?: boolean
    pnl?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type CopyTradeOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "userId" | "traceId" | "marketId" | "tradeId" | "direction" | "amount" | "txHash" | "builderFee" | "status" | "pnl" | "createdAt" | "updatedAt", ExtArgs["result"]["copyTrade"]>
  export type CopyTradeInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }
  export type CopyTradeIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }
  export type CopyTradeIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | ReasoningTraceDefaultArgs<ExtArgs>
    market?: boolean | MarketDefaultArgs<ExtArgs>
    trade?: boolean | CopyTrade$tradeArgs<ExtArgs>
  }

  export type $CopyTradePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "CopyTrade"
    objects: {
      user: Prisma.$UserPayload<ExtArgs>
      trace: Prisma.$ReasoningTracePayload<ExtArgs>
      market: Prisma.$MarketPayload<ExtArgs>
      trade: Prisma.$TradePayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      traceId: string
      marketId: string
      tradeId: string | null
      direction: $Enums.TradeDirection
      amount: number
      txHash: string | null
      builderFee: number
      status: $Enums.TradeStatus
      pnl: number | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["copyTrade"]>
    composites: {}
  }

  type CopyTradeGetPayload<S extends boolean | null | undefined | CopyTradeDefaultArgs> = $Result.GetResult<Prisma.$CopyTradePayload, S>

  type CopyTradeCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<CopyTradeFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: CopyTradeCountAggregateInputType | true
    }

  export interface CopyTradeDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['CopyTrade'], meta: { name: 'CopyTrade' } }
    /**
     * Find zero or one CopyTrade that matches the filter.
     * @param {CopyTradeFindUniqueArgs} args - Arguments to find a CopyTrade
     * @example
     * // Get one CopyTrade
     * const copyTrade = await prisma.copyTrade.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends CopyTradeFindUniqueArgs>(args: SelectSubset<T, CopyTradeFindUniqueArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one CopyTrade that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {CopyTradeFindUniqueOrThrowArgs} args - Arguments to find a CopyTrade
     * @example
     * // Get one CopyTrade
     * const copyTrade = await prisma.copyTrade.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends CopyTradeFindUniqueOrThrowArgs>(args: SelectSubset<T, CopyTradeFindUniqueOrThrowArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CopyTrade that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeFindFirstArgs} args - Arguments to find a CopyTrade
     * @example
     * // Get one CopyTrade
     * const copyTrade = await prisma.copyTrade.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends CopyTradeFindFirstArgs>(args?: SelectSubset<T, CopyTradeFindFirstArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first CopyTrade that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeFindFirstOrThrowArgs} args - Arguments to find a CopyTrade
     * @example
     * // Get one CopyTrade
     * const copyTrade = await prisma.copyTrade.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends CopyTradeFindFirstOrThrowArgs>(args?: SelectSubset<T, CopyTradeFindFirstOrThrowArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more CopyTrades that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all CopyTrades
     * const copyTrades = await prisma.copyTrade.findMany()
     * 
     * // Get first 10 CopyTrades
     * const copyTrades = await prisma.copyTrade.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const copyTradeWithIdOnly = await prisma.copyTrade.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends CopyTradeFindManyArgs>(args?: SelectSubset<T, CopyTradeFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a CopyTrade.
     * @param {CopyTradeCreateArgs} args - Arguments to create a CopyTrade.
     * @example
     * // Create one CopyTrade
     * const CopyTrade = await prisma.copyTrade.create({
     *   data: {
     *     // ... data to create a CopyTrade
     *   }
     * })
     * 
     */
    create<T extends CopyTradeCreateArgs>(args: SelectSubset<T, CopyTradeCreateArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many CopyTrades.
     * @param {CopyTradeCreateManyArgs} args - Arguments to create many CopyTrades.
     * @example
     * // Create many CopyTrades
     * const copyTrade = await prisma.copyTrade.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends CopyTradeCreateManyArgs>(args?: SelectSubset<T, CopyTradeCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many CopyTrades and returns the data saved in the database.
     * @param {CopyTradeCreateManyAndReturnArgs} args - Arguments to create many CopyTrades.
     * @example
     * // Create many CopyTrades
     * const copyTrade = await prisma.copyTrade.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many CopyTrades and only return the `id`
     * const copyTradeWithIdOnly = await prisma.copyTrade.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends CopyTradeCreateManyAndReturnArgs>(args?: SelectSubset<T, CopyTradeCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a CopyTrade.
     * @param {CopyTradeDeleteArgs} args - Arguments to delete one CopyTrade.
     * @example
     * // Delete one CopyTrade
     * const CopyTrade = await prisma.copyTrade.delete({
     *   where: {
     *     // ... filter to delete one CopyTrade
     *   }
     * })
     * 
     */
    delete<T extends CopyTradeDeleteArgs>(args: SelectSubset<T, CopyTradeDeleteArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one CopyTrade.
     * @param {CopyTradeUpdateArgs} args - Arguments to update one CopyTrade.
     * @example
     * // Update one CopyTrade
     * const copyTrade = await prisma.copyTrade.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends CopyTradeUpdateArgs>(args: SelectSubset<T, CopyTradeUpdateArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more CopyTrades.
     * @param {CopyTradeDeleteManyArgs} args - Arguments to filter CopyTrades to delete.
     * @example
     * // Delete a few CopyTrades
     * const { count } = await prisma.copyTrade.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends CopyTradeDeleteManyArgs>(args?: SelectSubset<T, CopyTradeDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CopyTrades.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many CopyTrades
     * const copyTrade = await prisma.copyTrade.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends CopyTradeUpdateManyArgs>(args: SelectSubset<T, CopyTradeUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more CopyTrades and returns the data updated in the database.
     * @param {CopyTradeUpdateManyAndReturnArgs} args - Arguments to update many CopyTrades.
     * @example
     * // Update many CopyTrades
     * const copyTrade = await prisma.copyTrade.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more CopyTrades and only return the `id`
     * const copyTradeWithIdOnly = await prisma.copyTrade.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends CopyTradeUpdateManyAndReturnArgs>(args: SelectSubset<T, CopyTradeUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one CopyTrade.
     * @param {CopyTradeUpsertArgs} args - Arguments to update or create a CopyTrade.
     * @example
     * // Update or create a CopyTrade
     * const copyTrade = await prisma.copyTrade.upsert({
     *   create: {
     *     // ... data to create a CopyTrade
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the CopyTrade we want to update
     *   }
     * })
     */
    upsert<T extends CopyTradeUpsertArgs>(args: SelectSubset<T, CopyTradeUpsertArgs<ExtArgs>>): Prisma__CopyTradeClient<$Result.GetResult<Prisma.$CopyTradePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of CopyTrades.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeCountArgs} args - Arguments to filter CopyTrades to count.
     * @example
     * // Count the number of CopyTrades
     * const count = await prisma.copyTrade.count({
     *   where: {
     *     // ... the filter for the CopyTrades we want to count
     *   }
     * })
    **/
    count<T extends CopyTradeCountArgs>(
      args?: Subset<T, CopyTradeCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CopyTradeCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a CopyTrade.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CopyTradeAggregateArgs>(args: Subset<T, CopyTradeAggregateArgs>): Prisma.PrismaPromise<GetCopyTradeAggregateType<T>>

    /**
     * Group by CopyTrade.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CopyTradeGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CopyTradeGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CopyTradeGroupByArgs['orderBy'] }
        : { orderBy?: CopyTradeGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CopyTradeGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCopyTradeGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the CopyTrade model
   */
  readonly fields: CopyTradeFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for CopyTrade.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__CopyTradeClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    trace<T extends ReasoningTraceDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ReasoningTraceDefaultArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    market<T extends MarketDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MarketDefaultArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    trade<T extends CopyTrade$tradeArgs<ExtArgs> = {}>(args?: Subset<T, CopyTrade$tradeArgs<ExtArgs>>): Prisma__TradeClient<$Result.GetResult<Prisma.$TradePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the CopyTrade model
   */
  interface CopyTradeFieldRefs {
    readonly id: FieldRef<"CopyTrade", 'String'>
    readonly userId: FieldRef<"CopyTrade", 'String'>
    readonly traceId: FieldRef<"CopyTrade", 'String'>
    readonly marketId: FieldRef<"CopyTrade", 'String'>
    readonly tradeId: FieldRef<"CopyTrade", 'String'>
    readonly direction: FieldRef<"CopyTrade", 'TradeDirection'>
    readonly amount: FieldRef<"CopyTrade", 'Float'>
    readonly txHash: FieldRef<"CopyTrade", 'String'>
    readonly builderFee: FieldRef<"CopyTrade", 'Float'>
    readonly status: FieldRef<"CopyTrade", 'TradeStatus'>
    readonly pnl: FieldRef<"CopyTrade", 'Float'>
    readonly createdAt: FieldRef<"CopyTrade", 'DateTime'>
    readonly updatedAt: FieldRef<"CopyTrade", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * CopyTrade findUnique
   */
  export type CopyTradeFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter, which CopyTrade to fetch.
     */
    where: CopyTradeWhereUniqueInput
  }

  /**
   * CopyTrade findUniqueOrThrow
   */
  export type CopyTradeFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter, which CopyTrade to fetch.
     */
    where: CopyTradeWhereUniqueInput
  }

  /**
   * CopyTrade findFirst
   */
  export type CopyTradeFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter, which CopyTrade to fetch.
     */
    where?: CopyTradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CopyTrades to fetch.
     */
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CopyTrades.
     */
    cursor?: CopyTradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CopyTrades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CopyTrades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CopyTrades.
     */
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * CopyTrade findFirstOrThrow
   */
  export type CopyTradeFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter, which CopyTrade to fetch.
     */
    where?: CopyTradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CopyTrades to fetch.
     */
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for CopyTrades.
     */
    cursor?: CopyTradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CopyTrades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CopyTrades.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of CopyTrades.
     */
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * CopyTrade findMany
   */
  export type CopyTradeFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter, which CopyTrades to fetch.
     */
    where?: CopyTradeWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of CopyTrades to fetch.
     */
    orderBy?: CopyTradeOrderByWithRelationInput | CopyTradeOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing CopyTrades.
     */
    cursor?: CopyTradeWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` CopyTrades from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` CopyTrades.
     */
    skip?: number
    distinct?: CopyTradeScalarFieldEnum | CopyTradeScalarFieldEnum[]
  }

  /**
   * CopyTrade create
   */
  export type CopyTradeCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * The data needed to create a CopyTrade.
     */
    data: XOR<CopyTradeCreateInput, CopyTradeUncheckedCreateInput>
  }

  /**
   * CopyTrade createMany
   */
  export type CopyTradeCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many CopyTrades.
     */
    data: CopyTradeCreateManyInput | CopyTradeCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * CopyTrade createManyAndReturn
   */
  export type CopyTradeCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * The data used to create many CopyTrades.
     */
    data: CopyTradeCreateManyInput | CopyTradeCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * CopyTrade update
   */
  export type CopyTradeUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * The data needed to update a CopyTrade.
     */
    data: XOR<CopyTradeUpdateInput, CopyTradeUncheckedUpdateInput>
    /**
     * Choose, which CopyTrade to update.
     */
    where: CopyTradeWhereUniqueInput
  }

  /**
   * CopyTrade updateMany
   */
  export type CopyTradeUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update CopyTrades.
     */
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyInput>
    /**
     * Filter which CopyTrades to update
     */
    where?: CopyTradeWhereInput
    /**
     * Limit how many CopyTrades to update.
     */
    limit?: number
  }

  /**
   * CopyTrade updateManyAndReturn
   */
  export type CopyTradeUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * The data used to update CopyTrades.
     */
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyInput>
    /**
     * Filter which CopyTrades to update
     */
    where?: CopyTradeWhereInput
    /**
     * Limit how many CopyTrades to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * CopyTrade upsert
   */
  export type CopyTradeUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * The filter to search for the CopyTrade to update in case it exists.
     */
    where: CopyTradeWhereUniqueInput
    /**
     * In case the CopyTrade found by the `where` argument doesn't exist, create a new CopyTrade with this data.
     */
    create: XOR<CopyTradeCreateInput, CopyTradeUncheckedCreateInput>
    /**
     * In case the CopyTrade was found with the provided `where` argument, update it with this data.
     */
    update: XOR<CopyTradeUpdateInput, CopyTradeUncheckedUpdateInput>
  }

  /**
   * CopyTrade delete
   */
  export type CopyTradeDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
    /**
     * Filter which CopyTrade to delete.
     */
    where: CopyTradeWhereUniqueInput
  }

  /**
   * CopyTrade deleteMany
   */
  export type CopyTradeDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which CopyTrades to delete
     */
    where?: CopyTradeWhereInput
    /**
     * Limit how many CopyTrades to delete.
     */
    limit?: number
  }

  /**
   * CopyTrade.trade
   */
  export type CopyTrade$tradeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Trade
     */
    select?: TradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Trade
     */
    omit?: TradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TradeInclude<ExtArgs> | null
    where?: TradeWhereInput
  }

  /**
   * CopyTrade without action
   */
  export type CopyTradeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the CopyTrade
     */
    select?: CopyTradeSelect<ExtArgs> | null
    /**
     * Omit specific fields from the CopyTrade
     */
    omit?: CopyTradeOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: CopyTradeInclude<ExtArgs> | null
  }


  /**
   * Model Subscription
   */

  export type AggregateSubscription = {
    _count: SubscriptionCountAggregateOutputType | null
    _avg: SubscriptionAvgAggregateOutputType | null
    _sum: SubscriptionSumAggregateOutputType | null
    _min: SubscriptionMinAggregateOutputType | null
    _max: SubscriptionMaxAggregateOutputType | null
  }

  export type SubscriptionAvgAggregateOutputType = {
    amountPaid: number | null
  }

  export type SubscriptionSumAggregateOutputType = {
    amountPaid: number | null
  }

  export type SubscriptionMinAggregateOutputType = {
    id: string | null
    userId: string | null
    traceId: string | null
    type: $Enums.SubscriptionType | null
    status: $Enums.SubscriptionStatus | null
    amountPaid: number | null
    currency: string | null
    txHash: string | null
    expiresAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SubscriptionMaxAggregateOutputType = {
    id: string | null
    userId: string | null
    traceId: string | null
    type: $Enums.SubscriptionType | null
    status: $Enums.SubscriptionStatus | null
    amountPaid: number | null
    currency: string | null
    txHash: string | null
    expiresAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type SubscriptionCountAggregateOutputType = {
    id: number
    userId: number
    traceId: number
    type: number
    status: number
    amountPaid: number
    currency: number
    txHash: number
    expiresAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type SubscriptionAvgAggregateInputType = {
    amountPaid?: true
  }

  export type SubscriptionSumAggregateInputType = {
    amountPaid?: true
  }

  export type SubscriptionMinAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    type?: true
    status?: true
    amountPaid?: true
    currency?: true
    txHash?: true
    expiresAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SubscriptionMaxAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    type?: true
    status?: true
    amountPaid?: true
    currency?: true
    txHash?: true
    expiresAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type SubscriptionCountAggregateInputType = {
    id?: true
    userId?: true
    traceId?: true
    type?: true
    status?: true
    amountPaid?: true
    currency?: true
    txHash?: true
    expiresAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type SubscriptionAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Subscription to aggregate.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Subscriptions
    **/
    _count?: true | SubscriptionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: SubscriptionAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: SubscriptionSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SubscriptionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SubscriptionMaxAggregateInputType
  }

  export type GetSubscriptionAggregateType<T extends SubscriptionAggregateArgs> = {
        [P in keyof T & keyof AggregateSubscription]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSubscription[P]>
      : GetScalarType<T[P], AggregateSubscription[P]>
  }




  export type SubscriptionGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SubscriptionWhereInput
    orderBy?: SubscriptionOrderByWithAggregationInput | SubscriptionOrderByWithAggregationInput[]
    by: SubscriptionScalarFieldEnum[] | SubscriptionScalarFieldEnum
    having?: SubscriptionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SubscriptionCountAggregateInputType | true
    _avg?: SubscriptionAvgAggregateInputType
    _sum?: SubscriptionSumAggregateInputType
    _min?: SubscriptionMinAggregateInputType
    _max?: SubscriptionMaxAggregateInputType
  }

  export type SubscriptionGroupByOutputType = {
    id: string
    userId: string
    traceId: string | null
    type: $Enums.SubscriptionType
    status: $Enums.SubscriptionStatus
    amountPaid: number
    currency: string
    txHash: string | null
    expiresAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: SubscriptionCountAggregateOutputType | null
    _avg: SubscriptionAvgAggregateOutputType | null
    _sum: SubscriptionSumAggregateOutputType | null
    _min: SubscriptionMinAggregateOutputType | null
    _max: SubscriptionMaxAggregateOutputType | null
  }

  type GetSubscriptionGroupByPayload<T extends SubscriptionGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SubscriptionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SubscriptionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SubscriptionGroupByOutputType[P]>
            : GetScalarType<T[P], SubscriptionGroupByOutputType[P]>
        }
      >
    >


  export type SubscriptionSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    type?: boolean
    status?: boolean
    amountPaid?: boolean
    currency?: boolean
    txHash?: boolean
    expiresAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    type?: boolean
    status?: boolean
    amountPaid?: boolean
    currency?: boolean
    txHash?: boolean
    expiresAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    userId?: boolean
    traceId?: boolean
    type?: boolean
    status?: boolean
    amountPaid?: boolean
    currency?: boolean
    txHash?: boolean
    expiresAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }, ExtArgs["result"]["subscription"]>

  export type SubscriptionSelectScalar = {
    id?: boolean
    userId?: boolean
    traceId?: boolean
    type?: boolean
    status?: boolean
    amountPaid?: boolean
    currency?: boolean
    txHash?: boolean
    expiresAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type SubscriptionOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "userId" | "traceId" | "type" | "status" | "amountPaid" | "currency" | "txHash" | "expiresAt" | "createdAt" | "updatedAt", ExtArgs["result"]["subscription"]>
  export type SubscriptionInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }
  export type SubscriptionIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }
  export type SubscriptionIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
    trace?: boolean | Subscription$traceArgs<ExtArgs>
  }

  export type $SubscriptionPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Subscription"
    objects: {
      user: Prisma.$UserPayload<ExtArgs>
      trace: Prisma.$ReasoningTracePayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      userId: string
      traceId: string | null
      type: $Enums.SubscriptionType
      status: $Enums.SubscriptionStatus
      amountPaid: number
      currency: string
      txHash: string | null
      expiresAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["subscription"]>
    composites: {}
  }

  type SubscriptionGetPayload<S extends boolean | null | undefined | SubscriptionDefaultArgs> = $Result.GetResult<Prisma.$SubscriptionPayload, S>

  type SubscriptionCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SubscriptionFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SubscriptionCountAggregateInputType | true
    }

  export interface SubscriptionDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Subscription'], meta: { name: 'Subscription' } }
    /**
     * Find zero or one Subscription that matches the filter.
     * @param {SubscriptionFindUniqueArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SubscriptionFindUniqueArgs>(args: SelectSubset<T, SubscriptionFindUniqueArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one Subscription that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SubscriptionFindUniqueOrThrowArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SubscriptionFindUniqueOrThrowArgs>(args: SelectSubset<T, SubscriptionFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Subscription that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindFirstArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SubscriptionFindFirstArgs>(args?: SelectSubset<T, SubscriptionFindFirstArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first Subscription that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindFirstOrThrowArgs} args - Arguments to find a Subscription
     * @example
     * // Get one Subscription
     * const subscription = await prisma.subscription.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SubscriptionFindFirstOrThrowArgs>(args?: SelectSubset<T, SubscriptionFindFirstOrThrowArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more Subscriptions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Subscriptions
     * const subscriptions = await prisma.subscription.findMany()
     * 
     * // Get first 10 Subscriptions
     * const subscriptions = await prisma.subscription.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const subscriptionWithIdOnly = await prisma.subscription.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SubscriptionFindManyArgs>(args?: SelectSubset<T, SubscriptionFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a Subscription.
     * @param {SubscriptionCreateArgs} args - Arguments to create a Subscription.
     * @example
     * // Create one Subscription
     * const Subscription = await prisma.subscription.create({
     *   data: {
     *     // ... data to create a Subscription
     *   }
     * })
     * 
     */
    create<T extends SubscriptionCreateArgs>(args: SelectSubset<T, SubscriptionCreateArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many Subscriptions.
     * @param {SubscriptionCreateManyArgs} args - Arguments to create many Subscriptions.
     * @example
     * // Create many Subscriptions
     * const subscription = await prisma.subscription.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SubscriptionCreateManyArgs>(args?: SelectSubset<T, SubscriptionCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Subscriptions and returns the data saved in the database.
     * @param {SubscriptionCreateManyAndReturnArgs} args - Arguments to create many Subscriptions.
     * @example
     * // Create many Subscriptions
     * const subscription = await prisma.subscription.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Subscriptions and only return the `id`
     * const subscriptionWithIdOnly = await prisma.subscription.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SubscriptionCreateManyAndReturnArgs>(args?: SelectSubset<T, SubscriptionCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a Subscription.
     * @param {SubscriptionDeleteArgs} args - Arguments to delete one Subscription.
     * @example
     * // Delete one Subscription
     * const Subscription = await prisma.subscription.delete({
     *   where: {
     *     // ... filter to delete one Subscription
     *   }
     * })
     * 
     */
    delete<T extends SubscriptionDeleteArgs>(args: SelectSubset<T, SubscriptionDeleteArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one Subscription.
     * @param {SubscriptionUpdateArgs} args - Arguments to update one Subscription.
     * @example
     * // Update one Subscription
     * const subscription = await prisma.subscription.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SubscriptionUpdateArgs>(args: SelectSubset<T, SubscriptionUpdateArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more Subscriptions.
     * @param {SubscriptionDeleteManyArgs} args - Arguments to filter Subscriptions to delete.
     * @example
     * // Delete a few Subscriptions
     * const { count } = await prisma.subscription.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SubscriptionDeleteManyArgs>(args?: SelectSubset<T, SubscriptionDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Subscriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Subscriptions
     * const subscription = await prisma.subscription.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SubscriptionUpdateManyArgs>(args: SelectSubset<T, SubscriptionUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Subscriptions and returns the data updated in the database.
     * @param {SubscriptionUpdateManyAndReturnArgs} args - Arguments to update many Subscriptions.
     * @example
     * // Update many Subscriptions
     * const subscription = await prisma.subscription.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more Subscriptions and only return the `id`
     * const subscriptionWithIdOnly = await prisma.subscription.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SubscriptionUpdateManyAndReturnArgs>(args: SelectSubset<T, SubscriptionUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one Subscription.
     * @param {SubscriptionUpsertArgs} args - Arguments to update or create a Subscription.
     * @example
     * // Update or create a Subscription
     * const subscription = await prisma.subscription.upsert({
     *   create: {
     *     // ... data to create a Subscription
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Subscription we want to update
     *   }
     * })
     */
    upsert<T extends SubscriptionUpsertArgs>(args: SelectSubset<T, SubscriptionUpsertArgs<ExtArgs>>): Prisma__SubscriptionClient<$Result.GetResult<Prisma.$SubscriptionPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of Subscriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionCountArgs} args - Arguments to filter Subscriptions to count.
     * @example
     * // Count the number of Subscriptions
     * const count = await prisma.subscription.count({
     *   where: {
     *     // ... the filter for the Subscriptions we want to count
     *   }
     * })
    **/
    count<T extends SubscriptionCountArgs>(
      args?: Subset<T, SubscriptionCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SubscriptionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Subscription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SubscriptionAggregateArgs>(args: Subset<T, SubscriptionAggregateArgs>): Prisma.PrismaPromise<GetSubscriptionAggregateType<T>>

    /**
     * Group by Subscription.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SubscriptionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SubscriptionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SubscriptionGroupByArgs['orderBy'] }
        : { orderBy?: SubscriptionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SubscriptionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSubscriptionGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Subscription model
   */
  readonly fields: SubscriptionFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Subscription.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SubscriptionClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>
    trace<T extends Subscription$traceArgs<ExtArgs> = {}>(args?: Subset<T, Subscription$traceArgs<ExtArgs>>): Prisma__ReasoningTraceClient<$Result.GetResult<Prisma.$ReasoningTracePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Subscription model
   */
  interface SubscriptionFieldRefs {
    readonly id: FieldRef<"Subscription", 'String'>
    readonly userId: FieldRef<"Subscription", 'String'>
    readonly traceId: FieldRef<"Subscription", 'String'>
    readonly type: FieldRef<"Subscription", 'SubscriptionType'>
    readonly status: FieldRef<"Subscription", 'SubscriptionStatus'>
    readonly amountPaid: FieldRef<"Subscription", 'Float'>
    readonly currency: FieldRef<"Subscription", 'String'>
    readonly txHash: FieldRef<"Subscription", 'String'>
    readonly expiresAt: FieldRef<"Subscription", 'DateTime'>
    readonly createdAt: FieldRef<"Subscription", 'DateTime'>
    readonly updatedAt: FieldRef<"Subscription", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Subscription findUnique
   */
  export type SubscriptionFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription findUniqueOrThrow
   */
  export type SubscriptionFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription findFirst
   */
  export type SubscriptionFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Subscriptions.
     */
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription findFirstOrThrow
   */
  export type SubscriptionFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscription to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Subscriptions.
     */
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription findMany
   */
  export type SubscriptionFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter, which Subscriptions to fetch.
     */
    where?: SubscriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Subscriptions to fetch.
     */
    orderBy?: SubscriptionOrderByWithRelationInput | SubscriptionOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Subscriptions.
     */
    cursor?: SubscriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Subscriptions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Subscriptions.
     */
    skip?: number
    distinct?: SubscriptionScalarFieldEnum | SubscriptionScalarFieldEnum[]
  }

  /**
   * Subscription create
   */
  export type SubscriptionCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The data needed to create a Subscription.
     */
    data: XOR<SubscriptionCreateInput, SubscriptionUncheckedCreateInput>
  }

  /**
   * Subscription createMany
   */
  export type SubscriptionCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Subscriptions.
     */
    data: SubscriptionCreateManyInput | SubscriptionCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Subscription createManyAndReturn
   */
  export type SubscriptionCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * The data used to create many Subscriptions.
     */
    data: SubscriptionCreateManyInput | SubscriptionCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Subscription update
   */
  export type SubscriptionUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The data needed to update a Subscription.
     */
    data: XOR<SubscriptionUpdateInput, SubscriptionUncheckedUpdateInput>
    /**
     * Choose, which Subscription to update.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription updateMany
   */
  export type SubscriptionUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Subscriptions.
     */
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyInput>
    /**
     * Filter which Subscriptions to update
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to update.
     */
    limit?: number
  }

  /**
   * Subscription updateManyAndReturn
   */
  export type SubscriptionUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * The data used to update Subscriptions.
     */
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyInput>
    /**
     * Filter which Subscriptions to update
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * Subscription upsert
   */
  export type SubscriptionUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * The filter to search for the Subscription to update in case it exists.
     */
    where: SubscriptionWhereUniqueInput
    /**
     * In case the Subscription found by the `where` argument doesn't exist, create a new Subscription with this data.
     */
    create: XOR<SubscriptionCreateInput, SubscriptionUncheckedCreateInput>
    /**
     * In case the Subscription was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SubscriptionUpdateInput, SubscriptionUncheckedUpdateInput>
  }

  /**
   * Subscription delete
   */
  export type SubscriptionDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
    /**
     * Filter which Subscription to delete.
     */
    where: SubscriptionWhereUniqueInput
  }

  /**
   * Subscription deleteMany
   */
  export type SubscriptionDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Subscriptions to delete
     */
    where?: SubscriptionWhereInput
    /**
     * Limit how many Subscriptions to delete.
     */
    limit?: number
  }

  /**
   * Subscription.trace
   */
  export type Subscription$traceArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ReasoningTrace
     */
    select?: ReasoningTraceSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ReasoningTrace
     */
    omit?: ReasoningTraceOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: ReasoningTraceInclude<ExtArgs> | null
    where?: ReasoningTraceWhereInput
  }

  /**
   * Subscription without action
   */
  export type SubscriptionDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Subscription
     */
    select?: SubscriptionSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Subscription
     */
    omit?: SubscriptionOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: SubscriptionInclude<ExtArgs> | null
  }


  /**
   * Model AgentLog
   */

  export type AggregateAgentLog = {
    _count: AgentLogCountAggregateOutputType | null
    _min: AgentLogMinAggregateOutputType | null
    _max: AgentLogMaxAggregateOutputType | null
  }

  export type AgentLogMinAggregateOutputType = {
    id: string | null
    agentType: $Enums.AgentType | null
    level: $Enums.LogLevel | null
    action: string | null
    marketId: string | null
    error: string | null
    createdAt: Date | null
  }

  export type AgentLogMaxAggregateOutputType = {
    id: string | null
    agentType: $Enums.AgentType | null
    level: $Enums.LogLevel | null
    action: string | null
    marketId: string | null
    error: string | null
    createdAt: Date | null
  }

  export type AgentLogCountAggregateOutputType = {
    id: number
    agentType: number
    level: number
    action: number
    marketId: number
    data: number
    error: number
    createdAt: number
    _all: number
  }


  export type AgentLogMinAggregateInputType = {
    id?: true
    agentType?: true
    level?: true
    action?: true
    marketId?: true
    error?: true
    createdAt?: true
  }

  export type AgentLogMaxAggregateInputType = {
    id?: true
    agentType?: true
    level?: true
    action?: true
    marketId?: true
    error?: true
    createdAt?: true
  }

  export type AgentLogCountAggregateInputType = {
    id?: true
    agentType?: true
    level?: true
    action?: true
    marketId?: true
    data?: true
    error?: true
    createdAt?: true
    _all?: true
  }

  export type AgentLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentLog to aggregate.
     */
    where?: AgentLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentLogs to fetch.
     */
    orderBy?: AgentLogOrderByWithRelationInput | AgentLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AgentLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AgentLogs
    **/
    _count?: true | AgentLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AgentLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AgentLogMaxAggregateInputType
  }

  export type GetAgentLogAggregateType<T extends AgentLogAggregateArgs> = {
        [P in keyof T & keyof AggregateAgentLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgentLog[P]>
      : GetScalarType<T[P], AggregateAgentLog[P]>
  }




  export type AgentLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AgentLogWhereInput
    orderBy?: AgentLogOrderByWithAggregationInput | AgentLogOrderByWithAggregationInput[]
    by: AgentLogScalarFieldEnum[] | AgentLogScalarFieldEnum
    having?: AgentLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AgentLogCountAggregateInputType | true
    _min?: AgentLogMinAggregateInputType
    _max?: AgentLogMaxAggregateInputType
  }

  export type AgentLogGroupByOutputType = {
    id: string
    agentType: $Enums.AgentType
    level: $Enums.LogLevel
    action: string
    marketId: string | null
    data: JsonValue | null
    error: string | null
    createdAt: Date
    _count: AgentLogCountAggregateOutputType | null
    _min: AgentLogMinAggregateOutputType | null
    _max: AgentLogMaxAggregateOutputType | null
  }

  type GetAgentLogGroupByPayload<T extends AgentLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AgentLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AgentLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AgentLogGroupByOutputType[P]>
            : GetScalarType<T[P], AgentLogGroupByOutputType[P]>
        }
      >
    >


  export type AgentLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentType?: boolean
    level?: boolean
    action?: boolean
    marketId?: boolean
    data?: boolean
    error?: boolean
    createdAt?: boolean
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }, ExtArgs["result"]["agentLog"]>

  export type AgentLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentType?: boolean
    level?: boolean
    action?: boolean
    marketId?: boolean
    data?: boolean
    error?: boolean
    createdAt?: boolean
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }, ExtArgs["result"]["agentLog"]>

  export type AgentLogSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentType?: boolean
    level?: boolean
    action?: boolean
    marketId?: boolean
    data?: boolean
    error?: boolean
    createdAt?: boolean
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }, ExtArgs["result"]["agentLog"]>

  export type AgentLogSelectScalar = {
    id?: boolean
    agentType?: boolean
    level?: boolean
    action?: boolean
    marketId?: boolean
    data?: boolean
    error?: boolean
    createdAt?: boolean
  }

  export type AgentLogOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "agentType" | "level" | "action" | "marketId" | "data" | "error" | "createdAt", ExtArgs["result"]["agentLog"]>
  export type AgentLogInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }
  export type AgentLogIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }
  export type AgentLogIncludeUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    market?: boolean | AgentLog$marketArgs<ExtArgs>
  }

  export type $AgentLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AgentLog"
    objects: {
      market: Prisma.$MarketPayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentType: $Enums.AgentType
      level: $Enums.LogLevel
      action: string
      marketId: string | null
      data: Prisma.JsonValue | null
      error: string | null
      createdAt: Date
    }, ExtArgs["result"]["agentLog"]>
    composites: {}
  }

  type AgentLogGetPayload<S extends boolean | null | undefined | AgentLogDefaultArgs> = $Result.GetResult<Prisma.$AgentLogPayload, S>

  type AgentLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<AgentLogFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: AgentLogCountAggregateInputType | true
    }

  export interface AgentLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AgentLog'], meta: { name: 'AgentLog' } }
    /**
     * Find zero or one AgentLog that matches the filter.
     * @param {AgentLogFindUniqueArgs} args - Arguments to find a AgentLog
     * @example
     * // Get one AgentLog
     * const agentLog = await prisma.agentLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AgentLogFindUniqueArgs>(args: SelectSubset<T, AgentLogFindUniqueArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one AgentLog that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {AgentLogFindUniqueOrThrowArgs} args - Arguments to find a AgentLog
     * @example
     * // Get one AgentLog
     * const agentLog = await prisma.agentLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AgentLogFindUniqueOrThrowArgs>(args: SelectSubset<T, AgentLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first AgentLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogFindFirstArgs} args - Arguments to find a AgentLog
     * @example
     * // Get one AgentLog
     * const agentLog = await prisma.agentLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AgentLogFindFirstArgs>(args?: SelectSubset<T, AgentLogFindFirstArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first AgentLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogFindFirstOrThrowArgs} args - Arguments to find a AgentLog
     * @example
     * // Get one AgentLog
     * const agentLog = await prisma.agentLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AgentLogFindFirstOrThrowArgs>(args?: SelectSubset<T, AgentLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more AgentLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AgentLogs
     * const agentLogs = await prisma.agentLog.findMany()
     * 
     * // Get first 10 AgentLogs
     * const agentLogs = await prisma.agentLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agentLogWithIdOnly = await prisma.agentLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AgentLogFindManyArgs>(args?: SelectSubset<T, AgentLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a AgentLog.
     * @param {AgentLogCreateArgs} args - Arguments to create a AgentLog.
     * @example
     * // Create one AgentLog
     * const AgentLog = await prisma.agentLog.create({
     *   data: {
     *     // ... data to create a AgentLog
     *   }
     * })
     * 
     */
    create<T extends AgentLogCreateArgs>(args: SelectSubset<T, AgentLogCreateArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many AgentLogs.
     * @param {AgentLogCreateManyArgs} args - Arguments to create many AgentLogs.
     * @example
     * // Create many AgentLogs
     * const agentLog = await prisma.agentLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AgentLogCreateManyArgs>(args?: SelectSubset<T, AgentLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AgentLogs and returns the data saved in the database.
     * @param {AgentLogCreateManyAndReturnArgs} args - Arguments to create many AgentLogs.
     * @example
     * // Create many AgentLogs
     * const agentLog = await prisma.agentLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AgentLogs and only return the `id`
     * const agentLogWithIdOnly = await prisma.agentLog.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AgentLogCreateManyAndReturnArgs>(args?: SelectSubset<T, AgentLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a AgentLog.
     * @param {AgentLogDeleteArgs} args - Arguments to delete one AgentLog.
     * @example
     * // Delete one AgentLog
     * const AgentLog = await prisma.agentLog.delete({
     *   where: {
     *     // ... filter to delete one AgentLog
     *   }
     * })
     * 
     */
    delete<T extends AgentLogDeleteArgs>(args: SelectSubset<T, AgentLogDeleteArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one AgentLog.
     * @param {AgentLogUpdateArgs} args - Arguments to update one AgentLog.
     * @example
     * // Update one AgentLog
     * const agentLog = await prisma.agentLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AgentLogUpdateArgs>(args: SelectSubset<T, AgentLogUpdateArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more AgentLogs.
     * @param {AgentLogDeleteManyArgs} args - Arguments to filter AgentLogs to delete.
     * @example
     * // Delete a few AgentLogs
     * const { count } = await prisma.agentLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AgentLogDeleteManyArgs>(args?: SelectSubset<T, AgentLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AgentLogs
     * const agentLog = await prisma.agentLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AgentLogUpdateManyArgs>(args: SelectSubset<T, AgentLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AgentLogs and returns the data updated in the database.
     * @param {AgentLogUpdateManyAndReturnArgs} args - Arguments to update many AgentLogs.
     * @example
     * // Update many AgentLogs
     * const agentLog = await prisma.agentLog.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more AgentLogs and only return the `id`
     * const agentLogWithIdOnly = await prisma.agentLog.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends AgentLogUpdateManyAndReturnArgs>(args: SelectSubset<T, AgentLogUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one AgentLog.
     * @param {AgentLogUpsertArgs} args - Arguments to update or create a AgentLog.
     * @example
     * // Update or create a AgentLog
     * const agentLog = await prisma.agentLog.upsert({
     *   create: {
     *     // ... data to create a AgentLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AgentLog we want to update
     *   }
     * })
     */
    upsert<T extends AgentLogUpsertArgs>(args: SelectSubset<T, AgentLogUpsertArgs<ExtArgs>>): Prisma__AgentLogClient<$Result.GetResult<Prisma.$AgentLogPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of AgentLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogCountArgs} args - Arguments to filter AgentLogs to count.
     * @example
     * // Count the number of AgentLogs
     * const count = await prisma.agentLog.count({
     *   where: {
     *     // ... the filter for the AgentLogs we want to count
     *   }
     * })
    **/
    count<T extends AgentLogCountArgs>(
      args?: Subset<T, AgentLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AgentLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AgentLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AgentLogAggregateArgs>(args: Subset<T, AgentLogAggregateArgs>): Prisma.PrismaPromise<GetAgentLogAggregateType<T>>

    /**
     * Group by AgentLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AgentLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AgentLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AgentLogGroupByArgs['orderBy'] }
        : { orderBy?: AgentLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AgentLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgentLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AgentLog model
   */
  readonly fields: AgentLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AgentLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AgentLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    market<T extends AgentLog$marketArgs<ExtArgs> = {}>(args?: Subset<T, AgentLog$marketArgs<ExtArgs>>): Prisma__MarketClient<$Result.GetResult<Prisma.$MarketPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AgentLog model
   */
  interface AgentLogFieldRefs {
    readonly id: FieldRef<"AgentLog", 'String'>
    readonly agentType: FieldRef<"AgentLog", 'AgentType'>
    readonly level: FieldRef<"AgentLog", 'LogLevel'>
    readonly action: FieldRef<"AgentLog", 'String'>
    readonly marketId: FieldRef<"AgentLog", 'String'>
    readonly data: FieldRef<"AgentLog", 'Json'>
    readonly error: FieldRef<"AgentLog", 'String'>
    readonly createdAt: FieldRef<"AgentLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AgentLog findUnique
   */
  export type AgentLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter, which AgentLog to fetch.
     */
    where: AgentLogWhereUniqueInput
  }

  /**
   * AgentLog findUniqueOrThrow
   */
  export type AgentLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter, which AgentLog to fetch.
     */
    where: AgentLogWhereUniqueInput
  }

  /**
   * AgentLog findFirst
   */
  export type AgentLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter, which AgentLog to fetch.
     */
    where?: AgentLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentLogs to fetch.
     */
    orderBy?: AgentLogOrderByWithRelationInput | AgentLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentLogs.
     */
    cursor?: AgentLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentLogs.
     */
    distinct?: AgentLogScalarFieldEnum | AgentLogScalarFieldEnum[]
  }

  /**
   * AgentLog findFirstOrThrow
   */
  export type AgentLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter, which AgentLog to fetch.
     */
    where?: AgentLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentLogs to fetch.
     */
    orderBy?: AgentLogOrderByWithRelationInput | AgentLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AgentLogs.
     */
    cursor?: AgentLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AgentLogs.
     */
    distinct?: AgentLogScalarFieldEnum | AgentLogScalarFieldEnum[]
  }

  /**
   * AgentLog findMany
   */
  export type AgentLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter, which AgentLogs to fetch.
     */
    where?: AgentLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AgentLogs to fetch.
     */
    orderBy?: AgentLogOrderByWithRelationInput | AgentLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AgentLogs.
     */
    cursor?: AgentLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AgentLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AgentLogs.
     */
    skip?: number
    distinct?: AgentLogScalarFieldEnum | AgentLogScalarFieldEnum[]
  }

  /**
   * AgentLog create
   */
  export type AgentLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * The data needed to create a AgentLog.
     */
    data: XOR<AgentLogCreateInput, AgentLogUncheckedCreateInput>
  }

  /**
   * AgentLog createMany
   */
  export type AgentLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AgentLogs.
     */
    data: AgentLogCreateManyInput | AgentLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AgentLog createManyAndReturn
   */
  export type AgentLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * The data used to create many AgentLogs.
     */
    data: AgentLogCreateManyInput | AgentLogCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentLog update
   */
  export type AgentLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * The data needed to update a AgentLog.
     */
    data: XOR<AgentLogUpdateInput, AgentLogUncheckedUpdateInput>
    /**
     * Choose, which AgentLog to update.
     */
    where: AgentLogWhereUniqueInput
  }

  /**
   * AgentLog updateMany
   */
  export type AgentLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AgentLogs.
     */
    data: XOR<AgentLogUpdateManyMutationInput, AgentLogUncheckedUpdateManyInput>
    /**
     * Filter which AgentLogs to update
     */
    where?: AgentLogWhereInput
    /**
     * Limit how many AgentLogs to update.
     */
    limit?: number
  }

  /**
   * AgentLog updateManyAndReturn
   */
  export type AgentLogUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * The data used to update AgentLogs.
     */
    data: XOR<AgentLogUpdateManyMutationInput, AgentLogUncheckedUpdateManyInput>
    /**
     * Filter which AgentLogs to update
     */
    where?: AgentLogWhereInput
    /**
     * Limit how many AgentLogs to update.
     */
    limit?: number
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogIncludeUpdateManyAndReturn<ExtArgs> | null
  }

  /**
   * AgentLog upsert
   */
  export type AgentLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * The filter to search for the AgentLog to update in case it exists.
     */
    where: AgentLogWhereUniqueInput
    /**
     * In case the AgentLog found by the `where` argument doesn't exist, create a new AgentLog with this data.
     */
    create: XOR<AgentLogCreateInput, AgentLogUncheckedCreateInput>
    /**
     * In case the AgentLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AgentLogUpdateInput, AgentLogUncheckedUpdateInput>
  }

  /**
   * AgentLog delete
   */
  export type AgentLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
    /**
     * Filter which AgentLog to delete.
     */
    where: AgentLogWhereUniqueInput
  }

  /**
   * AgentLog deleteMany
   */
  export type AgentLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AgentLogs to delete
     */
    where?: AgentLogWhereInput
    /**
     * Limit how many AgentLogs to delete.
     */
    limit?: number
  }

  /**
   * AgentLog.market
   */
  export type AgentLog$marketArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Market
     */
    select?: MarketSelect<ExtArgs> | null
    /**
     * Omit specific fields from the Market
     */
    omit?: MarketOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: MarketInclude<ExtArgs> | null
    where?: MarketWhereInput
  }

  /**
   * AgentLog without action
   */
  export type AgentLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AgentLog
     */
    select?: AgentLogSelect<ExtArgs> | null
    /**
     * Omit specific fields from the AgentLog
     */
    omit?: AgentLogOmit<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AgentLogInclude<ExtArgs> | null
  }


  /**
   * Model SignalCache
   */

  export type AggregateSignalCache = {
    _count: SignalCacheCountAggregateOutputType | null
    _min: SignalCacheMinAggregateOutputType | null
    _max: SignalCacheMaxAggregateOutputType | null
  }

  export type SignalCacheMinAggregateOutputType = {
    id: string | null
    source: string | null
    fetchedAt: Date | null
    expiresAt: Date | null
  }

  export type SignalCacheMaxAggregateOutputType = {
    id: string | null
    source: string | null
    fetchedAt: Date | null
    expiresAt: Date | null
  }

  export type SignalCacheCountAggregateOutputType = {
    id: number
    source: number
    payload: number
    fetchedAt: number
    expiresAt: number
    _all: number
  }


  export type SignalCacheMinAggregateInputType = {
    id?: true
    source?: true
    fetchedAt?: true
    expiresAt?: true
  }

  export type SignalCacheMaxAggregateInputType = {
    id?: true
    source?: true
    fetchedAt?: true
    expiresAt?: true
  }

  export type SignalCacheCountAggregateInputType = {
    id?: true
    source?: true
    payload?: true
    fetchedAt?: true
    expiresAt?: true
    _all?: true
  }

  export type SignalCacheAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SignalCache to aggregate.
     */
    where?: SignalCacheWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SignalCaches to fetch.
     */
    orderBy?: SignalCacheOrderByWithRelationInput | SignalCacheOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: SignalCacheWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SignalCaches from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SignalCaches.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned SignalCaches
    **/
    _count?: true | SignalCacheCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: SignalCacheMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: SignalCacheMaxAggregateInputType
  }

  export type GetSignalCacheAggregateType<T extends SignalCacheAggregateArgs> = {
        [P in keyof T & keyof AggregateSignalCache]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSignalCache[P]>
      : GetScalarType<T[P], AggregateSignalCache[P]>
  }




  export type SignalCacheGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: SignalCacheWhereInput
    orderBy?: SignalCacheOrderByWithAggregationInput | SignalCacheOrderByWithAggregationInput[]
    by: SignalCacheScalarFieldEnum[] | SignalCacheScalarFieldEnum
    having?: SignalCacheScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: SignalCacheCountAggregateInputType | true
    _min?: SignalCacheMinAggregateInputType
    _max?: SignalCacheMaxAggregateInputType
  }

  export type SignalCacheGroupByOutputType = {
    id: string
    source: string
    payload: JsonValue
    fetchedAt: Date
    expiresAt: Date
    _count: SignalCacheCountAggregateOutputType | null
    _min: SignalCacheMinAggregateOutputType | null
    _max: SignalCacheMaxAggregateOutputType | null
  }

  type GetSignalCacheGroupByPayload<T extends SignalCacheGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<SignalCacheGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof SignalCacheGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], SignalCacheGroupByOutputType[P]>
            : GetScalarType<T[P], SignalCacheGroupByOutputType[P]>
        }
      >
    >


  export type SignalCacheSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    source?: boolean
    payload?: boolean
    fetchedAt?: boolean
    expiresAt?: boolean
  }, ExtArgs["result"]["signalCache"]>

  export type SignalCacheSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    source?: boolean
    payload?: boolean
    fetchedAt?: boolean
    expiresAt?: boolean
  }, ExtArgs["result"]["signalCache"]>

  export type SignalCacheSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    source?: boolean
    payload?: boolean
    fetchedAt?: boolean
    expiresAt?: boolean
  }, ExtArgs["result"]["signalCache"]>

  export type SignalCacheSelectScalar = {
    id?: boolean
    source?: boolean
    payload?: boolean
    fetchedAt?: boolean
    expiresAt?: boolean
  }

  export type SignalCacheOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "source" | "payload" | "fetchedAt" | "expiresAt", ExtArgs["result"]["signalCache"]>

  export type $SignalCachePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "SignalCache"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      source: string
      payload: Prisma.JsonValue
      fetchedAt: Date
      expiresAt: Date
    }, ExtArgs["result"]["signalCache"]>
    composites: {}
  }

  type SignalCacheGetPayload<S extends boolean | null | undefined | SignalCacheDefaultArgs> = $Result.GetResult<Prisma.$SignalCachePayload, S>

  type SignalCacheCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<SignalCacheFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: SignalCacheCountAggregateInputType | true
    }

  export interface SignalCacheDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['SignalCache'], meta: { name: 'SignalCache' } }
    /**
     * Find zero or one SignalCache that matches the filter.
     * @param {SignalCacheFindUniqueArgs} args - Arguments to find a SignalCache
     * @example
     * // Get one SignalCache
     * const signalCache = await prisma.signalCache.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends SignalCacheFindUniqueArgs>(args: SelectSubset<T, SignalCacheFindUniqueArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one SignalCache that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {SignalCacheFindUniqueOrThrowArgs} args - Arguments to find a SignalCache
     * @example
     * // Get one SignalCache
     * const signalCache = await prisma.signalCache.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends SignalCacheFindUniqueOrThrowArgs>(args: SelectSubset<T, SignalCacheFindUniqueOrThrowArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SignalCache that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheFindFirstArgs} args - Arguments to find a SignalCache
     * @example
     * // Get one SignalCache
     * const signalCache = await prisma.signalCache.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends SignalCacheFindFirstArgs>(args?: SelectSubset<T, SignalCacheFindFirstArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first SignalCache that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheFindFirstOrThrowArgs} args - Arguments to find a SignalCache
     * @example
     * // Get one SignalCache
     * const signalCache = await prisma.signalCache.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends SignalCacheFindFirstOrThrowArgs>(args?: SelectSubset<T, SignalCacheFindFirstOrThrowArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more SignalCaches that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all SignalCaches
     * const signalCaches = await prisma.signalCache.findMany()
     * 
     * // Get first 10 SignalCaches
     * const signalCaches = await prisma.signalCache.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const signalCacheWithIdOnly = await prisma.signalCache.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends SignalCacheFindManyArgs>(args?: SelectSubset<T, SignalCacheFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a SignalCache.
     * @param {SignalCacheCreateArgs} args - Arguments to create a SignalCache.
     * @example
     * // Create one SignalCache
     * const SignalCache = await prisma.signalCache.create({
     *   data: {
     *     // ... data to create a SignalCache
     *   }
     * })
     * 
     */
    create<T extends SignalCacheCreateArgs>(args: SelectSubset<T, SignalCacheCreateArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many SignalCaches.
     * @param {SignalCacheCreateManyArgs} args - Arguments to create many SignalCaches.
     * @example
     * // Create many SignalCaches
     * const signalCache = await prisma.signalCache.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends SignalCacheCreateManyArgs>(args?: SelectSubset<T, SignalCacheCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many SignalCaches and returns the data saved in the database.
     * @param {SignalCacheCreateManyAndReturnArgs} args - Arguments to create many SignalCaches.
     * @example
     * // Create many SignalCaches
     * const signalCache = await prisma.signalCache.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many SignalCaches and only return the `id`
     * const signalCacheWithIdOnly = await prisma.signalCache.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends SignalCacheCreateManyAndReturnArgs>(args?: SelectSubset<T, SignalCacheCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a SignalCache.
     * @param {SignalCacheDeleteArgs} args - Arguments to delete one SignalCache.
     * @example
     * // Delete one SignalCache
     * const SignalCache = await prisma.signalCache.delete({
     *   where: {
     *     // ... filter to delete one SignalCache
     *   }
     * })
     * 
     */
    delete<T extends SignalCacheDeleteArgs>(args: SelectSubset<T, SignalCacheDeleteArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one SignalCache.
     * @param {SignalCacheUpdateArgs} args - Arguments to update one SignalCache.
     * @example
     * // Update one SignalCache
     * const signalCache = await prisma.signalCache.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends SignalCacheUpdateArgs>(args: SelectSubset<T, SignalCacheUpdateArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more SignalCaches.
     * @param {SignalCacheDeleteManyArgs} args - Arguments to filter SignalCaches to delete.
     * @example
     * // Delete a few SignalCaches
     * const { count } = await prisma.signalCache.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends SignalCacheDeleteManyArgs>(args?: SelectSubset<T, SignalCacheDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SignalCaches.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many SignalCaches
     * const signalCache = await prisma.signalCache.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends SignalCacheUpdateManyArgs>(args: SelectSubset<T, SignalCacheUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more SignalCaches and returns the data updated in the database.
     * @param {SignalCacheUpdateManyAndReturnArgs} args - Arguments to update many SignalCaches.
     * @example
     * // Update many SignalCaches
     * const signalCache = await prisma.signalCache.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more SignalCaches and only return the `id`
     * const signalCacheWithIdOnly = await prisma.signalCache.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends SignalCacheUpdateManyAndReturnArgs>(args: SelectSubset<T, SignalCacheUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one SignalCache.
     * @param {SignalCacheUpsertArgs} args - Arguments to update or create a SignalCache.
     * @example
     * // Update or create a SignalCache
     * const signalCache = await prisma.signalCache.upsert({
     *   create: {
     *     // ... data to create a SignalCache
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the SignalCache we want to update
     *   }
     * })
     */
    upsert<T extends SignalCacheUpsertArgs>(args: SelectSubset<T, SignalCacheUpsertArgs<ExtArgs>>): Prisma__SignalCacheClient<$Result.GetResult<Prisma.$SignalCachePayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of SignalCaches.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheCountArgs} args - Arguments to filter SignalCaches to count.
     * @example
     * // Count the number of SignalCaches
     * const count = await prisma.signalCache.count({
     *   where: {
     *     // ... the filter for the SignalCaches we want to count
     *   }
     * })
    **/
    count<T extends SignalCacheCountArgs>(
      args?: Subset<T, SignalCacheCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], SignalCacheCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a SignalCache.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends SignalCacheAggregateArgs>(args: Subset<T, SignalCacheAggregateArgs>): Prisma.PrismaPromise<GetSignalCacheAggregateType<T>>

    /**
     * Group by SignalCache.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {SignalCacheGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends SignalCacheGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: SignalCacheGroupByArgs['orderBy'] }
        : { orderBy?: SignalCacheGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, SignalCacheGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSignalCacheGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the SignalCache model
   */
  readonly fields: SignalCacheFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for SignalCache.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__SignalCacheClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the SignalCache model
   */
  interface SignalCacheFieldRefs {
    readonly id: FieldRef<"SignalCache", 'String'>
    readonly source: FieldRef<"SignalCache", 'String'>
    readonly payload: FieldRef<"SignalCache", 'Json'>
    readonly fetchedAt: FieldRef<"SignalCache", 'DateTime'>
    readonly expiresAt: FieldRef<"SignalCache", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * SignalCache findUnique
   */
  export type SignalCacheFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter, which SignalCache to fetch.
     */
    where: SignalCacheWhereUniqueInput
  }

  /**
   * SignalCache findUniqueOrThrow
   */
  export type SignalCacheFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter, which SignalCache to fetch.
     */
    where: SignalCacheWhereUniqueInput
  }

  /**
   * SignalCache findFirst
   */
  export type SignalCacheFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter, which SignalCache to fetch.
     */
    where?: SignalCacheWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SignalCaches to fetch.
     */
    orderBy?: SignalCacheOrderByWithRelationInput | SignalCacheOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SignalCaches.
     */
    cursor?: SignalCacheWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SignalCaches from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SignalCaches.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SignalCaches.
     */
    distinct?: SignalCacheScalarFieldEnum | SignalCacheScalarFieldEnum[]
  }

  /**
   * SignalCache findFirstOrThrow
   */
  export type SignalCacheFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter, which SignalCache to fetch.
     */
    where?: SignalCacheWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SignalCaches to fetch.
     */
    orderBy?: SignalCacheOrderByWithRelationInput | SignalCacheOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for SignalCaches.
     */
    cursor?: SignalCacheWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SignalCaches from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SignalCaches.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of SignalCaches.
     */
    distinct?: SignalCacheScalarFieldEnum | SignalCacheScalarFieldEnum[]
  }

  /**
   * SignalCache findMany
   */
  export type SignalCacheFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter, which SignalCaches to fetch.
     */
    where?: SignalCacheWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of SignalCaches to fetch.
     */
    orderBy?: SignalCacheOrderByWithRelationInput | SignalCacheOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing SignalCaches.
     */
    cursor?: SignalCacheWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` SignalCaches from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` SignalCaches.
     */
    skip?: number
    distinct?: SignalCacheScalarFieldEnum | SignalCacheScalarFieldEnum[]
  }

  /**
   * SignalCache create
   */
  export type SignalCacheCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * The data needed to create a SignalCache.
     */
    data: XOR<SignalCacheCreateInput, SignalCacheUncheckedCreateInput>
  }

  /**
   * SignalCache createMany
   */
  export type SignalCacheCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many SignalCaches.
     */
    data: SignalCacheCreateManyInput | SignalCacheCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SignalCache createManyAndReturn
   */
  export type SignalCacheCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * The data used to create many SignalCaches.
     */
    data: SignalCacheCreateManyInput | SignalCacheCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * SignalCache update
   */
  export type SignalCacheUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * The data needed to update a SignalCache.
     */
    data: XOR<SignalCacheUpdateInput, SignalCacheUncheckedUpdateInput>
    /**
     * Choose, which SignalCache to update.
     */
    where: SignalCacheWhereUniqueInput
  }

  /**
   * SignalCache updateMany
   */
  export type SignalCacheUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update SignalCaches.
     */
    data: XOR<SignalCacheUpdateManyMutationInput, SignalCacheUncheckedUpdateManyInput>
    /**
     * Filter which SignalCaches to update
     */
    where?: SignalCacheWhereInput
    /**
     * Limit how many SignalCaches to update.
     */
    limit?: number
  }

  /**
   * SignalCache updateManyAndReturn
   */
  export type SignalCacheUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * The data used to update SignalCaches.
     */
    data: XOR<SignalCacheUpdateManyMutationInput, SignalCacheUncheckedUpdateManyInput>
    /**
     * Filter which SignalCaches to update
     */
    where?: SignalCacheWhereInput
    /**
     * Limit how many SignalCaches to update.
     */
    limit?: number
  }

  /**
   * SignalCache upsert
   */
  export type SignalCacheUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * The filter to search for the SignalCache to update in case it exists.
     */
    where: SignalCacheWhereUniqueInput
    /**
     * In case the SignalCache found by the `where` argument doesn't exist, create a new SignalCache with this data.
     */
    create: XOR<SignalCacheCreateInput, SignalCacheUncheckedCreateInput>
    /**
     * In case the SignalCache was found with the provided `where` argument, update it with this data.
     */
    update: XOR<SignalCacheUpdateInput, SignalCacheUncheckedUpdateInput>
  }

  /**
   * SignalCache delete
   */
  export type SignalCacheDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
    /**
     * Filter which SignalCache to delete.
     */
    where: SignalCacheWhereUniqueInput
  }

  /**
   * SignalCache deleteMany
   */
  export type SignalCacheDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which SignalCaches to delete
     */
    where?: SignalCacheWhereInput
    /**
     * Limit how many SignalCaches to delete.
     */
    limit?: number
  }

  /**
   * SignalCache without action
   */
  export type SignalCacheDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the SignalCache
     */
    select?: SignalCacheSelect<ExtArgs> | null
    /**
     * Omit specific fields from the SignalCache
     */
    omit?: SignalCacheOmit<ExtArgs> | null
  }


  /**
   * Model BlockIndex
   */

  export type AggregateBlockIndex = {
    _count: BlockIndexCountAggregateOutputType | null
    _avg: BlockIndexAvgAggregateOutputType | null
    _sum: BlockIndexSumAggregateOutputType | null
    _min: BlockIndexMinAggregateOutputType | null
    _max: BlockIndexMaxAggregateOutputType | null
  }

  export type BlockIndexAvgAggregateOutputType = {
    chainId: number | null
    lastBlockNumber: number | null
  }

  export type BlockIndexSumAggregateOutputType = {
    chainId: number | null
    lastBlockNumber: bigint | null
  }

  export type BlockIndexMinAggregateOutputType = {
    id: string | null
    chainId: number | null
    lastBlockNumber: bigint | null
    updatedAt: Date | null
  }

  export type BlockIndexMaxAggregateOutputType = {
    id: string | null
    chainId: number | null
    lastBlockNumber: bigint | null
    updatedAt: Date | null
  }

  export type BlockIndexCountAggregateOutputType = {
    id: number
    chainId: number
    lastBlockNumber: number
    updatedAt: number
    _all: number
  }


  export type BlockIndexAvgAggregateInputType = {
    chainId?: true
    lastBlockNumber?: true
  }

  export type BlockIndexSumAggregateInputType = {
    chainId?: true
    lastBlockNumber?: true
  }

  export type BlockIndexMinAggregateInputType = {
    id?: true
    chainId?: true
    lastBlockNumber?: true
    updatedAt?: true
  }

  export type BlockIndexMaxAggregateInputType = {
    id?: true
    chainId?: true
    lastBlockNumber?: true
    updatedAt?: true
  }

  export type BlockIndexCountAggregateInputType = {
    id?: true
    chainId?: true
    lastBlockNumber?: true
    updatedAt?: true
    _all?: true
  }

  export type BlockIndexAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BlockIndex to aggregate.
     */
    where?: BlockIndexWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BlockIndices to fetch.
     */
    orderBy?: BlockIndexOrderByWithRelationInput | BlockIndexOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BlockIndexWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BlockIndices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BlockIndices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned BlockIndices
    **/
    _count?: true | BlockIndexCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: BlockIndexAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: BlockIndexSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BlockIndexMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BlockIndexMaxAggregateInputType
  }

  export type GetBlockIndexAggregateType<T extends BlockIndexAggregateArgs> = {
        [P in keyof T & keyof AggregateBlockIndex]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBlockIndex[P]>
      : GetScalarType<T[P], AggregateBlockIndex[P]>
  }




  export type BlockIndexGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BlockIndexWhereInput
    orderBy?: BlockIndexOrderByWithAggregationInput | BlockIndexOrderByWithAggregationInput[]
    by: BlockIndexScalarFieldEnum[] | BlockIndexScalarFieldEnum
    having?: BlockIndexScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BlockIndexCountAggregateInputType | true
    _avg?: BlockIndexAvgAggregateInputType
    _sum?: BlockIndexSumAggregateInputType
    _min?: BlockIndexMinAggregateInputType
    _max?: BlockIndexMaxAggregateInputType
  }

  export type BlockIndexGroupByOutputType = {
    id: string
    chainId: number
    lastBlockNumber: bigint
    updatedAt: Date
    _count: BlockIndexCountAggregateOutputType | null
    _avg: BlockIndexAvgAggregateOutputType | null
    _sum: BlockIndexSumAggregateOutputType | null
    _min: BlockIndexMinAggregateOutputType | null
    _max: BlockIndexMaxAggregateOutputType | null
  }

  type GetBlockIndexGroupByPayload<T extends BlockIndexGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<BlockIndexGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BlockIndexGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BlockIndexGroupByOutputType[P]>
            : GetScalarType<T[P], BlockIndexGroupByOutputType[P]>
        }
      >
    >


  export type BlockIndexSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    chainId?: boolean
    lastBlockNumber?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["blockIndex"]>

  export type BlockIndexSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    chainId?: boolean
    lastBlockNumber?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["blockIndex"]>

  export type BlockIndexSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    chainId?: boolean
    lastBlockNumber?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["blockIndex"]>

  export type BlockIndexSelectScalar = {
    id?: boolean
    chainId?: boolean
    lastBlockNumber?: boolean
    updatedAt?: boolean
  }

  export type BlockIndexOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "chainId" | "lastBlockNumber" | "updatedAt", ExtArgs["result"]["blockIndex"]>

  export type $BlockIndexPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "BlockIndex"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      chainId: number
      lastBlockNumber: bigint
      updatedAt: Date
    }, ExtArgs["result"]["blockIndex"]>
    composites: {}
  }

  type BlockIndexGetPayload<S extends boolean | null | undefined | BlockIndexDefaultArgs> = $Result.GetResult<Prisma.$BlockIndexPayload, S>

  type BlockIndexCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<BlockIndexFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: BlockIndexCountAggregateInputType | true
    }

  export interface BlockIndexDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['BlockIndex'], meta: { name: 'BlockIndex' } }
    /**
     * Find zero or one BlockIndex that matches the filter.
     * @param {BlockIndexFindUniqueArgs} args - Arguments to find a BlockIndex
     * @example
     * // Get one BlockIndex
     * const blockIndex = await prisma.blockIndex.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BlockIndexFindUniqueArgs>(args: SelectSubset<T, BlockIndexFindUniqueArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one BlockIndex that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {BlockIndexFindUniqueOrThrowArgs} args - Arguments to find a BlockIndex
     * @example
     * // Get one BlockIndex
     * const blockIndex = await prisma.blockIndex.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BlockIndexFindUniqueOrThrowArgs>(args: SelectSubset<T, BlockIndexFindUniqueOrThrowArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first BlockIndex that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexFindFirstArgs} args - Arguments to find a BlockIndex
     * @example
     * // Get one BlockIndex
     * const blockIndex = await prisma.blockIndex.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BlockIndexFindFirstArgs>(args?: SelectSubset<T, BlockIndexFindFirstArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first BlockIndex that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexFindFirstOrThrowArgs} args - Arguments to find a BlockIndex
     * @example
     * // Get one BlockIndex
     * const blockIndex = await prisma.blockIndex.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BlockIndexFindFirstOrThrowArgs>(args?: SelectSubset<T, BlockIndexFindFirstOrThrowArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more BlockIndices that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all BlockIndices
     * const blockIndices = await prisma.blockIndex.findMany()
     * 
     * // Get first 10 BlockIndices
     * const blockIndices = await prisma.blockIndex.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const blockIndexWithIdOnly = await prisma.blockIndex.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends BlockIndexFindManyArgs>(args?: SelectSubset<T, BlockIndexFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a BlockIndex.
     * @param {BlockIndexCreateArgs} args - Arguments to create a BlockIndex.
     * @example
     * // Create one BlockIndex
     * const BlockIndex = await prisma.blockIndex.create({
     *   data: {
     *     // ... data to create a BlockIndex
     *   }
     * })
     * 
     */
    create<T extends BlockIndexCreateArgs>(args: SelectSubset<T, BlockIndexCreateArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many BlockIndices.
     * @param {BlockIndexCreateManyArgs} args - Arguments to create many BlockIndices.
     * @example
     * // Create many BlockIndices
     * const blockIndex = await prisma.blockIndex.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends BlockIndexCreateManyArgs>(args?: SelectSubset<T, BlockIndexCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many BlockIndices and returns the data saved in the database.
     * @param {BlockIndexCreateManyAndReturnArgs} args - Arguments to create many BlockIndices.
     * @example
     * // Create many BlockIndices
     * const blockIndex = await prisma.blockIndex.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many BlockIndices and only return the `id`
     * const blockIndexWithIdOnly = await prisma.blockIndex.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends BlockIndexCreateManyAndReturnArgs>(args?: SelectSubset<T, BlockIndexCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a BlockIndex.
     * @param {BlockIndexDeleteArgs} args - Arguments to delete one BlockIndex.
     * @example
     * // Delete one BlockIndex
     * const BlockIndex = await prisma.blockIndex.delete({
     *   where: {
     *     // ... filter to delete one BlockIndex
     *   }
     * })
     * 
     */
    delete<T extends BlockIndexDeleteArgs>(args: SelectSubset<T, BlockIndexDeleteArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one BlockIndex.
     * @param {BlockIndexUpdateArgs} args - Arguments to update one BlockIndex.
     * @example
     * // Update one BlockIndex
     * const blockIndex = await prisma.blockIndex.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends BlockIndexUpdateArgs>(args: SelectSubset<T, BlockIndexUpdateArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more BlockIndices.
     * @param {BlockIndexDeleteManyArgs} args - Arguments to filter BlockIndices to delete.
     * @example
     * // Delete a few BlockIndices
     * const { count } = await prisma.blockIndex.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends BlockIndexDeleteManyArgs>(args?: SelectSubset<T, BlockIndexDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more BlockIndices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many BlockIndices
     * const blockIndex = await prisma.blockIndex.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends BlockIndexUpdateManyArgs>(args: SelectSubset<T, BlockIndexUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more BlockIndices and returns the data updated in the database.
     * @param {BlockIndexUpdateManyAndReturnArgs} args - Arguments to update many BlockIndices.
     * @example
     * // Update many BlockIndices
     * const blockIndex = await prisma.blockIndex.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more BlockIndices and only return the `id`
     * const blockIndexWithIdOnly = await prisma.blockIndex.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends BlockIndexUpdateManyAndReturnArgs>(args: SelectSubset<T, BlockIndexUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one BlockIndex.
     * @param {BlockIndexUpsertArgs} args - Arguments to update or create a BlockIndex.
     * @example
     * // Update or create a BlockIndex
     * const blockIndex = await prisma.blockIndex.upsert({
     *   create: {
     *     // ... data to create a BlockIndex
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the BlockIndex we want to update
     *   }
     * })
     */
    upsert<T extends BlockIndexUpsertArgs>(args: SelectSubset<T, BlockIndexUpsertArgs<ExtArgs>>): Prisma__BlockIndexClient<$Result.GetResult<Prisma.$BlockIndexPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of BlockIndices.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexCountArgs} args - Arguments to filter BlockIndices to count.
     * @example
     * // Count the number of BlockIndices
     * const count = await prisma.blockIndex.count({
     *   where: {
     *     // ... the filter for the BlockIndices we want to count
     *   }
     * })
    **/
    count<T extends BlockIndexCountArgs>(
      args?: Subset<T, BlockIndexCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BlockIndexCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a BlockIndex.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends BlockIndexAggregateArgs>(args: Subset<T, BlockIndexAggregateArgs>): Prisma.PrismaPromise<GetBlockIndexAggregateType<T>>

    /**
     * Group by BlockIndex.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BlockIndexGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends BlockIndexGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BlockIndexGroupByArgs['orderBy'] }
        : { orderBy?: BlockIndexGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, BlockIndexGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBlockIndexGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the BlockIndex model
   */
  readonly fields: BlockIndexFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for BlockIndex.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__BlockIndexClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the BlockIndex model
   */
  interface BlockIndexFieldRefs {
    readonly id: FieldRef<"BlockIndex", 'String'>
    readonly chainId: FieldRef<"BlockIndex", 'Int'>
    readonly lastBlockNumber: FieldRef<"BlockIndex", 'BigInt'>
    readonly updatedAt: FieldRef<"BlockIndex", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * BlockIndex findUnique
   */
  export type BlockIndexFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter, which BlockIndex to fetch.
     */
    where: BlockIndexWhereUniqueInput
  }

  /**
   * BlockIndex findUniqueOrThrow
   */
  export type BlockIndexFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter, which BlockIndex to fetch.
     */
    where: BlockIndexWhereUniqueInput
  }

  /**
   * BlockIndex findFirst
   */
  export type BlockIndexFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter, which BlockIndex to fetch.
     */
    where?: BlockIndexWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BlockIndices to fetch.
     */
    orderBy?: BlockIndexOrderByWithRelationInput | BlockIndexOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BlockIndices.
     */
    cursor?: BlockIndexWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BlockIndices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BlockIndices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BlockIndices.
     */
    distinct?: BlockIndexScalarFieldEnum | BlockIndexScalarFieldEnum[]
  }

  /**
   * BlockIndex findFirstOrThrow
   */
  export type BlockIndexFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter, which BlockIndex to fetch.
     */
    where?: BlockIndexWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BlockIndices to fetch.
     */
    orderBy?: BlockIndexOrderByWithRelationInput | BlockIndexOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for BlockIndices.
     */
    cursor?: BlockIndexWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BlockIndices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BlockIndices.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of BlockIndices.
     */
    distinct?: BlockIndexScalarFieldEnum | BlockIndexScalarFieldEnum[]
  }

  /**
   * BlockIndex findMany
   */
  export type BlockIndexFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter, which BlockIndices to fetch.
     */
    where?: BlockIndexWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of BlockIndices to fetch.
     */
    orderBy?: BlockIndexOrderByWithRelationInput | BlockIndexOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing BlockIndices.
     */
    cursor?: BlockIndexWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` BlockIndices from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` BlockIndices.
     */
    skip?: number
    distinct?: BlockIndexScalarFieldEnum | BlockIndexScalarFieldEnum[]
  }

  /**
   * BlockIndex create
   */
  export type BlockIndexCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * The data needed to create a BlockIndex.
     */
    data: XOR<BlockIndexCreateInput, BlockIndexUncheckedCreateInput>
  }

  /**
   * BlockIndex createMany
   */
  export type BlockIndexCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many BlockIndices.
     */
    data: BlockIndexCreateManyInput | BlockIndexCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * BlockIndex createManyAndReturn
   */
  export type BlockIndexCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * The data used to create many BlockIndices.
     */
    data: BlockIndexCreateManyInput | BlockIndexCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * BlockIndex update
   */
  export type BlockIndexUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * The data needed to update a BlockIndex.
     */
    data: XOR<BlockIndexUpdateInput, BlockIndexUncheckedUpdateInput>
    /**
     * Choose, which BlockIndex to update.
     */
    where: BlockIndexWhereUniqueInput
  }

  /**
   * BlockIndex updateMany
   */
  export type BlockIndexUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update BlockIndices.
     */
    data: XOR<BlockIndexUpdateManyMutationInput, BlockIndexUncheckedUpdateManyInput>
    /**
     * Filter which BlockIndices to update
     */
    where?: BlockIndexWhereInput
    /**
     * Limit how many BlockIndices to update.
     */
    limit?: number
  }

  /**
   * BlockIndex updateManyAndReturn
   */
  export type BlockIndexUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * The data used to update BlockIndices.
     */
    data: XOR<BlockIndexUpdateManyMutationInput, BlockIndexUncheckedUpdateManyInput>
    /**
     * Filter which BlockIndices to update
     */
    where?: BlockIndexWhereInput
    /**
     * Limit how many BlockIndices to update.
     */
    limit?: number
  }

  /**
   * BlockIndex upsert
   */
  export type BlockIndexUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * The filter to search for the BlockIndex to update in case it exists.
     */
    where: BlockIndexWhereUniqueInput
    /**
     * In case the BlockIndex found by the `where` argument doesn't exist, create a new BlockIndex with this data.
     */
    create: XOR<BlockIndexCreateInput, BlockIndexUncheckedCreateInput>
    /**
     * In case the BlockIndex was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BlockIndexUpdateInput, BlockIndexUncheckedUpdateInput>
  }

  /**
   * BlockIndex delete
   */
  export type BlockIndexDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
    /**
     * Filter which BlockIndex to delete.
     */
    where: BlockIndexWhereUniqueInput
  }

  /**
   * BlockIndex deleteMany
   */
  export type BlockIndexDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which BlockIndices to delete
     */
    where?: BlockIndexWhereInput
    /**
     * Limit how many BlockIndices to delete.
     */
    limit?: number
  }

  /**
   * BlockIndex without action
   */
  export type BlockIndexDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BlockIndex
     */
    select?: BlockIndexSelect<ExtArgs> | null
    /**
     * Omit specific fields from the BlockIndex
     */
    omit?: BlockIndexOmit<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const UserScalarFieldEnum: {
    id: 'id',
    walletAddress: 'walletAddress',
    email: 'email',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const MarketScalarFieldEnum: {
    id: 'id',
    question: 'question',
    category: 'category',
    status: 'status',
    settlementCurrency: 'settlementCurrency',
    initialYesProb: 'initialYesProb',
    currentYesProb: 'currentYesProb',
    confidenceInterval: 'confidenceInterval',
    expiryTimestamp: 'expiryTimestamp',
    resolutionOracle: 'resolutionOracle',
    minimumLiquidity: 'minimumLiquidity',
    totalLiquidity: 'totalLiquidity',
    onChainAddress: 'onChainAddress',
    txHash: 'txHash',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type MarketScalarFieldEnum = (typeof MarketScalarFieldEnum)[keyof typeof MarketScalarFieldEnum]


  export const TradeScalarFieldEnum: {
    id: 'id',
    marketId: 'marketId',
    direction: 'direction',
    status: 'status',
    amount: 'amount',
    price: 'price',
    edgeDetected: 'edgeDetected',
    kellyFraction: 'kellyFraction',
    txHash: 'txHash',
    builderFee: 'builderFee',
    errorMessage: 'errorMessage',
    executedAt: 'executedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TradeScalarFieldEnum = (typeof TradeScalarFieldEnum)[keyof typeof TradeScalarFieldEnum]


  export const PositionScalarFieldEnum: {
    id: 'id',
    marketId: 'marketId',
    tradeId: 'tradeId',
    direction: 'direction',
    status: 'status',
    entryPrice: 'entryPrice',
    currentPrice: 'currentPrice',
    size: 'size',
    pnl: 'pnl',
    hedgeMarketId: 'hedgeMarketId',
    closedAt: 'closedAt',
    closeReason: 'closeReason',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type PositionScalarFieldEnum = (typeof PositionScalarFieldEnum)[keyof typeof PositionScalarFieldEnum]


  export const ReasoningTraceScalarFieldEnum: {
    id: 'id',
    marketId: 'marketId',
    agentType: 'agentType',
    decisionType: 'decisionType',
    sourcesUsed: 'sourcesUsed',
    probabilityEstimate: 'probabilityEstimate',
    marketProbability: 'marketProbability',
    edge: 'edge',
    confidenceInterval: 'confidenceInterval',
    betFraction: 'betFraction',
    betSizeUsdc: 'betSizeUsdc',
    hedgeConditions: 'hedgeConditions',
    agentWallet: 'agentWallet',
    signature: 'signature',
    ipfsCid: 'ipfsCid',
    sha256Hash: 'sha256Hash',
    onChainTxHash: 'onChainTxHash',
    verified: 'verified',
    isPublic: 'isPublic',
    previewSources: 'previewSources',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ReasoningTraceScalarFieldEnum = (typeof ReasoningTraceScalarFieldEnum)[keyof typeof ReasoningTraceScalarFieldEnum]


  export const CopyTradeScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    traceId: 'traceId',
    marketId: 'marketId',
    tradeId: 'tradeId',
    direction: 'direction',
    amount: 'amount',
    txHash: 'txHash',
    builderFee: 'builderFee',
    status: 'status',
    pnl: 'pnl',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type CopyTradeScalarFieldEnum = (typeof CopyTradeScalarFieldEnum)[keyof typeof CopyTradeScalarFieldEnum]


  export const SubscriptionScalarFieldEnum: {
    id: 'id',
    userId: 'userId',
    traceId: 'traceId',
    type: 'type',
    status: 'status',
    amountPaid: 'amountPaid',
    currency: 'currency',
    txHash: 'txHash',
    expiresAt: 'expiresAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type SubscriptionScalarFieldEnum = (typeof SubscriptionScalarFieldEnum)[keyof typeof SubscriptionScalarFieldEnum]


  export const AgentLogScalarFieldEnum: {
    id: 'id',
    agentType: 'agentType',
    level: 'level',
    action: 'action',
    marketId: 'marketId',
    data: 'data',
    error: 'error',
    createdAt: 'createdAt'
  };

  export type AgentLogScalarFieldEnum = (typeof AgentLogScalarFieldEnum)[keyof typeof AgentLogScalarFieldEnum]


  export const SignalCacheScalarFieldEnum: {
    id: 'id',
    source: 'source',
    payload: 'payload',
    fetchedAt: 'fetchedAt',
    expiresAt: 'expiresAt'
  };

  export type SignalCacheScalarFieldEnum = (typeof SignalCacheScalarFieldEnum)[keyof typeof SignalCacheScalarFieldEnum]


  export const BlockIndexScalarFieldEnum: {
    id: 'id',
    chainId: 'chainId',
    lastBlockNumber: 'lastBlockNumber',
    updatedAt: 'updatedAt'
  };

  export type BlockIndexScalarFieldEnum = (typeof BlockIndexScalarFieldEnum)[keyof typeof BlockIndexScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'MarketCategory'
   */
  export type EnumMarketCategoryFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MarketCategory'>
    


  /**
   * Reference to a field of type 'MarketCategory[]'
   */
  export type ListEnumMarketCategoryFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MarketCategory[]'>
    


  /**
   * Reference to a field of type 'MarketStatus'
   */
  export type EnumMarketStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MarketStatus'>
    


  /**
   * Reference to a field of type 'MarketStatus[]'
   */
  export type ListEnumMarketStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'MarketStatus[]'>
    


  /**
   * Reference to a field of type 'SettlementCurrency'
   */
  export type EnumSettlementCurrencyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SettlementCurrency'>
    


  /**
   * Reference to a field of type 'SettlementCurrency[]'
   */
  export type ListEnumSettlementCurrencyFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SettlementCurrency[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'QueryMode'
   */
  export type EnumQueryModeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'QueryMode'>
    


  /**
   * Reference to a field of type 'TradeDirection'
   */
  export type EnumTradeDirectionFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TradeDirection'>
    


  /**
   * Reference to a field of type 'TradeDirection[]'
   */
  export type ListEnumTradeDirectionFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TradeDirection[]'>
    


  /**
   * Reference to a field of type 'TradeStatus'
   */
  export type EnumTradeStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TradeStatus'>
    


  /**
   * Reference to a field of type 'TradeStatus[]'
   */
  export type ListEnumTradeStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'TradeStatus[]'>
    


  /**
   * Reference to a field of type 'PositionStatus'
   */
  export type EnumPositionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PositionStatus'>
    


  /**
   * Reference to a field of type 'PositionStatus[]'
   */
  export type ListEnumPositionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'PositionStatus[]'>
    


  /**
   * Reference to a field of type 'AgentType'
   */
  export type EnumAgentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AgentType'>
    


  /**
   * Reference to a field of type 'AgentType[]'
   */
  export type ListEnumAgentTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'AgentType[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'SubscriptionType'
   */
  export type EnumSubscriptionTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionType'>
    


  /**
   * Reference to a field of type 'SubscriptionType[]'
   */
  export type ListEnumSubscriptionTypeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionType[]'>
    


  /**
   * Reference to a field of type 'SubscriptionStatus'
   */
  export type EnumSubscriptionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionStatus'>
    


  /**
   * Reference to a field of type 'SubscriptionStatus[]'
   */
  export type ListEnumSubscriptionStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'SubscriptionStatus[]'>
    


  /**
   * Reference to a field of type 'LogLevel'
   */
  export type EnumLogLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LogLevel'>
    


  /**
   * Reference to a field of type 'LogLevel[]'
   */
  export type ListEnumLogLevelFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LogLevel[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'BigInt'
   */
  export type BigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt'>
    


  /**
   * Reference to a field of type 'BigInt[]'
   */
  export type ListBigIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'BigInt[]'>
    
  /**
   * Deep Input Types
   */


  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    id?: StringFilter<"User"> | string
    walletAddress?: StringFilter<"User"> | string
    email?: StringNullableFilter<"User"> | string | null
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    subscriptions?: SubscriptionListRelationFilter
    copyTrades?: CopyTradeListRelationFilter
  }

  export type UserOrderByWithRelationInput = {
    id?: SortOrder
    walletAddress?: SortOrder
    email?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    subscriptions?: SubscriptionOrderByRelationAggregateInput
    copyTrades?: CopyTradeOrderByRelationAggregateInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    walletAddress?: string
    email?: string
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    subscriptions?: SubscriptionListRelationFilter
    copyTrades?: CopyTradeListRelationFilter
  }, "id" | "walletAddress" | "email">

  export type UserOrderByWithAggregationInput = {
    id?: SortOrder
    walletAddress?: SortOrder
    email?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserCountOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"User"> | string
    walletAddress?: StringWithAggregatesFilter<"User"> | string
    email?: StringNullableWithAggregatesFilter<"User"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
  }

  export type MarketWhereInput = {
    AND?: MarketWhereInput | MarketWhereInput[]
    OR?: MarketWhereInput[]
    NOT?: MarketWhereInput | MarketWhereInput[]
    id?: StringFilter<"Market"> | string
    question?: StringFilter<"Market"> | string
    category?: EnumMarketCategoryFilter<"Market"> | $Enums.MarketCategory
    status?: EnumMarketStatusFilter<"Market"> | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFilter<"Market"> | $Enums.SettlementCurrency
    initialYesProb?: FloatFilter<"Market"> | number
    currentYesProb?: FloatNullableFilter<"Market"> | number | null
    confidenceInterval?: JsonFilter<"Market">
    expiryTimestamp?: DateTimeFilter<"Market"> | Date | string
    resolutionOracle?: StringNullableFilter<"Market"> | string | null
    minimumLiquidity?: FloatFilter<"Market"> | number
    totalLiquidity?: FloatFilter<"Market"> | number
    onChainAddress?: StringNullableFilter<"Market"> | string | null
    txHash?: StringNullableFilter<"Market"> | string | null
    createdAt?: DateTimeFilter<"Market"> | Date | string
    updatedAt?: DateTimeFilter<"Market"> | Date | string
    trades?: TradeListRelationFilter
    positions?: PositionListRelationFilter
    reasoningTraces?: ReasoningTraceListRelationFilter
    copyTrades?: CopyTradeListRelationFilter
    agentLogs?: AgentLogListRelationFilter
  }

  export type MarketOrderByWithRelationInput = {
    id?: SortOrder
    question?: SortOrder
    category?: SortOrder
    status?: SortOrder
    settlementCurrency?: SortOrder
    initialYesProb?: SortOrder
    currentYesProb?: SortOrderInput | SortOrder
    confidenceInterval?: SortOrder
    expiryTimestamp?: SortOrder
    resolutionOracle?: SortOrderInput | SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
    onChainAddress?: SortOrderInput | SortOrder
    txHash?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    trades?: TradeOrderByRelationAggregateInput
    positions?: PositionOrderByRelationAggregateInput
    reasoningTraces?: ReasoningTraceOrderByRelationAggregateInput
    copyTrades?: CopyTradeOrderByRelationAggregateInput
    agentLogs?: AgentLogOrderByRelationAggregateInput
  }

  export type MarketWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    onChainAddress?: string
    AND?: MarketWhereInput | MarketWhereInput[]
    OR?: MarketWhereInput[]
    NOT?: MarketWhereInput | MarketWhereInput[]
    question?: StringFilter<"Market"> | string
    category?: EnumMarketCategoryFilter<"Market"> | $Enums.MarketCategory
    status?: EnumMarketStatusFilter<"Market"> | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFilter<"Market"> | $Enums.SettlementCurrency
    initialYesProb?: FloatFilter<"Market"> | number
    currentYesProb?: FloatNullableFilter<"Market"> | number | null
    confidenceInterval?: JsonFilter<"Market">
    expiryTimestamp?: DateTimeFilter<"Market"> | Date | string
    resolutionOracle?: StringNullableFilter<"Market"> | string | null
    minimumLiquidity?: FloatFilter<"Market"> | number
    totalLiquidity?: FloatFilter<"Market"> | number
    txHash?: StringNullableFilter<"Market"> | string | null
    createdAt?: DateTimeFilter<"Market"> | Date | string
    updatedAt?: DateTimeFilter<"Market"> | Date | string
    trades?: TradeListRelationFilter
    positions?: PositionListRelationFilter
    reasoningTraces?: ReasoningTraceListRelationFilter
    copyTrades?: CopyTradeListRelationFilter
    agentLogs?: AgentLogListRelationFilter
  }, "id" | "onChainAddress">

  export type MarketOrderByWithAggregationInput = {
    id?: SortOrder
    question?: SortOrder
    category?: SortOrder
    status?: SortOrder
    settlementCurrency?: SortOrder
    initialYesProb?: SortOrder
    currentYesProb?: SortOrderInput | SortOrder
    confidenceInterval?: SortOrder
    expiryTimestamp?: SortOrder
    resolutionOracle?: SortOrderInput | SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
    onChainAddress?: SortOrderInput | SortOrder
    txHash?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: MarketCountOrderByAggregateInput
    _avg?: MarketAvgOrderByAggregateInput
    _max?: MarketMaxOrderByAggregateInput
    _min?: MarketMinOrderByAggregateInput
    _sum?: MarketSumOrderByAggregateInput
  }

  export type MarketScalarWhereWithAggregatesInput = {
    AND?: MarketScalarWhereWithAggregatesInput | MarketScalarWhereWithAggregatesInput[]
    OR?: MarketScalarWhereWithAggregatesInput[]
    NOT?: MarketScalarWhereWithAggregatesInput | MarketScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Market"> | string
    question?: StringWithAggregatesFilter<"Market"> | string
    category?: EnumMarketCategoryWithAggregatesFilter<"Market"> | $Enums.MarketCategory
    status?: EnumMarketStatusWithAggregatesFilter<"Market"> | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyWithAggregatesFilter<"Market"> | $Enums.SettlementCurrency
    initialYesProb?: FloatWithAggregatesFilter<"Market"> | number
    currentYesProb?: FloatNullableWithAggregatesFilter<"Market"> | number | null
    confidenceInterval?: JsonWithAggregatesFilter<"Market">
    expiryTimestamp?: DateTimeWithAggregatesFilter<"Market"> | Date | string
    resolutionOracle?: StringNullableWithAggregatesFilter<"Market"> | string | null
    minimumLiquidity?: FloatWithAggregatesFilter<"Market"> | number
    totalLiquidity?: FloatWithAggregatesFilter<"Market"> | number
    onChainAddress?: StringNullableWithAggregatesFilter<"Market"> | string | null
    txHash?: StringNullableWithAggregatesFilter<"Market"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Market"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Market"> | Date | string
  }

  export type TradeWhereInput = {
    AND?: TradeWhereInput | TradeWhereInput[]
    OR?: TradeWhereInput[]
    NOT?: TradeWhereInput | TradeWhereInput[]
    id?: StringFilter<"Trade"> | string
    marketId?: StringFilter<"Trade"> | string
    direction?: EnumTradeDirectionFilter<"Trade"> | $Enums.TradeDirection
    status?: EnumTradeStatusFilter<"Trade"> | $Enums.TradeStatus
    amount?: FloatFilter<"Trade"> | number
    price?: FloatFilter<"Trade"> | number
    edgeDetected?: FloatFilter<"Trade"> | number
    kellyFraction?: FloatFilter<"Trade"> | number
    txHash?: StringNullableFilter<"Trade"> | string | null
    builderFee?: FloatFilter<"Trade"> | number
    errorMessage?: StringNullableFilter<"Trade"> | string | null
    executedAt?: DateTimeNullableFilter<"Trade"> | Date | string | null
    createdAt?: DateTimeFilter<"Trade"> | Date | string
    updatedAt?: DateTimeFilter<"Trade"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    position?: XOR<PositionNullableScalarRelationFilter, PositionWhereInput> | null
    copyTrades?: CopyTradeListRelationFilter
  }

  export type TradeOrderByWithRelationInput = {
    id?: SortOrder
    marketId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    txHash?: SortOrderInput | SortOrder
    builderFee?: SortOrder
    errorMessage?: SortOrderInput | SortOrder
    executedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    market?: MarketOrderByWithRelationInput
    position?: PositionOrderByWithRelationInput
    copyTrades?: CopyTradeOrderByRelationAggregateInput
  }

  export type TradeWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TradeWhereInput | TradeWhereInput[]
    OR?: TradeWhereInput[]
    NOT?: TradeWhereInput | TradeWhereInput[]
    marketId?: StringFilter<"Trade"> | string
    direction?: EnumTradeDirectionFilter<"Trade"> | $Enums.TradeDirection
    status?: EnumTradeStatusFilter<"Trade"> | $Enums.TradeStatus
    amount?: FloatFilter<"Trade"> | number
    price?: FloatFilter<"Trade"> | number
    edgeDetected?: FloatFilter<"Trade"> | number
    kellyFraction?: FloatFilter<"Trade"> | number
    txHash?: StringNullableFilter<"Trade"> | string | null
    builderFee?: FloatFilter<"Trade"> | number
    errorMessage?: StringNullableFilter<"Trade"> | string | null
    executedAt?: DateTimeNullableFilter<"Trade"> | Date | string | null
    createdAt?: DateTimeFilter<"Trade"> | Date | string
    updatedAt?: DateTimeFilter<"Trade"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    position?: XOR<PositionNullableScalarRelationFilter, PositionWhereInput> | null
    copyTrades?: CopyTradeListRelationFilter
  }, "id">

  export type TradeOrderByWithAggregationInput = {
    id?: SortOrder
    marketId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    txHash?: SortOrderInput | SortOrder
    builderFee?: SortOrder
    errorMessage?: SortOrderInput | SortOrder
    executedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TradeCountOrderByAggregateInput
    _avg?: TradeAvgOrderByAggregateInput
    _max?: TradeMaxOrderByAggregateInput
    _min?: TradeMinOrderByAggregateInput
    _sum?: TradeSumOrderByAggregateInput
  }

  export type TradeScalarWhereWithAggregatesInput = {
    AND?: TradeScalarWhereWithAggregatesInput | TradeScalarWhereWithAggregatesInput[]
    OR?: TradeScalarWhereWithAggregatesInput[]
    NOT?: TradeScalarWhereWithAggregatesInput | TradeScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Trade"> | string
    marketId?: StringWithAggregatesFilter<"Trade"> | string
    direction?: EnumTradeDirectionWithAggregatesFilter<"Trade"> | $Enums.TradeDirection
    status?: EnumTradeStatusWithAggregatesFilter<"Trade"> | $Enums.TradeStatus
    amount?: FloatWithAggregatesFilter<"Trade"> | number
    price?: FloatWithAggregatesFilter<"Trade"> | number
    edgeDetected?: FloatWithAggregatesFilter<"Trade"> | number
    kellyFraction?: FloatWithAggregatesFilter<"Trade"> | number
    txHash?: StringNullableWithAggregatesFilter<"Trade"> | string | null
    builderFee?: FloatWithAggregatesFilter<"Trade"> | number
    errorMessage?: StringNullableWithAggregatesFilter<"Trade"> | string | null
    executedAt?: DateTimeNullableWithAggregatesFilter<"Trade"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Trade"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Trade"> | Date | string
  }

  export type PositionWhereInput = {
    AND?: PositionWhereInput | PositionWhereInput[]
    OR?: PositionWhereInput[]
    NOT?: PositionWhereInput | PositionWhereInput[]
    id?: StringFilter<"Position"> | string
    marketId?: StringFilter<"Position"> | string
    tradeId?: StringFilter<"Position"> | string
    direction?: EnumTradeDirectionFilter<"Position"> | $Enums.TradeDirection
    status?: EnumPositionStatusFilter<"Position"> | $Enums.PositionStatus
    entryPrice?: FloatFilter<"Position"> | number
    currentPrice?: FloatNullableFilter<"Position"> | number | null
    size?: FloatFilter<"Position"> | number
    pnl?: FloatFilter<"Position"> | number
    hedgeMarketId?: StringNullableFilter<"Position"> | string | null
    closedAt?: DateTimeNullableFilter<"Position"> | Date | string | null
    closeReason?: StringNullableFilter<"Position"> | string | null
    createdAt?: DateTimeFilter<"Position"> | Date | string
    updatedAt?: DateTimeFilter<"Position"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    trade?: XOR<TradeScalarRelationFilter, TradeWhereInput>
  }

  export type PositionOrderByWithRelationInput = {
    id?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    entryPrice?: SortOrder
    currentPrice?: SortOrderInput | SortOrder
    size?: SortOrder
    pnl?: SortOrder
    hedgeMarketId?: SortOrderInput | SortOrder
    closedAt?: SortOrderInput | SortOrder
    closeReason?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    market?: MarketOrderByWithRelationInput
    trade?: TradeOrderByWithRelationInput
  }

  export type PositionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    tradeId?: string
    AND?: PositionWhereInput | PositionWhereInput[]
    OR?: PositionWhereInput[]
    NOT?: PositionWhereInput | PositionWhereInput[]
    marketId?: StringFilter<"Position"> | string
    direction?: EnumTradeDirectionFilter<"Position"> | $Enums.TradeDirection
    status?: EnumPositionStatusFilter<"Position"> | $Enums.PositionStatus
    entryPrice?: FloatFilter<"Position"> | number
    currentPrice?: FloatNullableFilter<"Position"> | number | null
    size?: FloatFilter<"Position"> | number
    pnl?: FloatFilter<"Position"> | number
    hedgeMarketId?: StringNullableFilter<"Position"> | string | null
    closedAt?: DateTimeNullableFilter<"Position"> | Date | string | null
    closeReason?: StringNullableFilter<"Position"> | string | null
    createdAt?: DateTimeFilter<"Position"> | Date | string
    updatedAt?: DateTimeFilter<"Position"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    trade?: XOR<TradeScalarRelationFilter, TradeWhereInput>
  }, "id" | "tradeId">

  export type PositionOrderByWithAggregationInput = {
    id?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    entryPrice?: SortOrder
    currentPrice?: SortOrderInput | SortOrder
    size?: SortOrder
    pnl?: SortOrder
    hedgeMarketId?: SortOrderInput | SortOrder
    closedAt?: SortOrderInput | SortOrder
    closeReason?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: PositionCountOrderByAggregateInput
    _avg?: PositionAvgOrderByAggregateInput
    _max?: PositionMaxOrderByAggregateInput
    _min?: PositionMinOrderByAggregateInput
    _sum?: PositionSumOrderByAggregateInput
  }

  export type PositionScalarWhereWithAggregatesInput = {
    AND?: PositionScalarWhereWithAggregatesInput | PositionScalarWhereWithAggregatesInput[]
    OR?: PositionScalarWhereWithAggregatesInput[]
    NOT?: PositionScalarWhereWithAggregatesInput | PositionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Position"> | string
    marketId?: StringWithAggregatesFilter<"Position"> | string
    tradeId?: StringWithAggregatesFilter<"Position"> | string
    direction?: EnumTradeDirectionWithAggregatesFilter<"Position"> | $Enums.TradeDirection
    status?: EnumPositionStatusWithAggregatesFilter<"Position"> | $Enums.PositionStatus
    entryPrice?: FloatWithAggregatesFilter<"Position"> | number
    currentPrice?: FloatNullableWithAggregatesFilter<"Position"> | number | null
    size?: FloatWithAggregatesFilter<"Position"> | number
    pnl?: FloatWithAggregatesFilter<"Position"> | number
    hedgeMarketId?: StringNullableWithAggregatesFilter<"Position"> | string | null
    closedAt?: DateTimeNullableWithAggregatesFilter<"Position"> | Date | string | null
    closeReason?: StringNullableWithAggregatesFilter<"Position"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Position"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Position"> | Date | string
  }

  export type ReasoningTraceWhereInput = {
    AND?: ReasoningTraceWhereInput | ReasoningTraceWhereInput[]
    OR?: ReasoningTraceWhereInput[]
    NOT?: ReasoningTraceWhereInput | ReasoningTraceWhereInput[]
    id?: StringFilter<"ReasoningTrace"> | string
    marketId?: StringFilter<"ReasoningTrace"> | string
    agentType?: EnumAgentTypeFilter<"ReasoningTrace"> | $Enums.AgentType
    decisionType?: StringFilter<"ReasoningTrace"> | string
    sourcesUsed?: JsonFilter<"ReasoningTrace">
    probabilityEstimate?: FloatFilter<"ReasoningTrace"> | number
    marketProbability?: FloatFilter<"ReasoningTrace"> | number
    edge?: FloatFilter<"ReasoningTrace"> | number
    confidenceInterval?: JsonFilter<"ReasoningTrace">
    betFraction?: FloatNullableFilter<"ReasoningTrace"> | number | null
    betSizeUsdc?: FloatNullableFilter<"ReasoningTrace"> | number | null
    hedgeConditions?: JsonNullableFilter<"ReasoningTrace">
    agentWallet?: StringNullableFilter<"ReasoningTrace"> | string | null
    signature?: StringNullableFilter<"ReasoningTrace"> | string | null
    ipfsCid?: StringNullableFilter<"ReasoningTrace"> | string | null
    sha256Hash?: StringNullableFilter<"ReasoningTrace"> | string | null
    onChainTxHash?: StringNullableFilter<"ReasoningTrace"> | string | null
    verified?: BoolFilter<"ReasoningTrace"> | boolean
    isPublic?: BoolFilter<"ReasoningTrace"> | boolean
    previewSources?: JsonNullableFilter<"ReasoningTrace">
    createdAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
    updatedAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    copyTrades?: CopyTradeListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }

  export type ReasoningTraceOrderByWithRelationInput = {
    id?: SortOrder
    marketId?: SortOrder
    agentType?: SortOrder
    decisionType?: SortOrder
    sourcesUsed?: SortOrder
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    confidenceInterval?: SortOrder
    betFraction?: SortOrderInput | SortOrder
    betSizeUsdc?: SortOrderInput | SortOrder
    hedgeConditions?: SortOrderInput | SortOrder
    agentWallet?: SortOrderInput | SortOrder
    signature?: SortOrderInput | SortOrder
    ipfsCid?: SortOrderInput | SortOrder
    sha256Hash?: SortOrderInput | SortOrder
    onChainTxHash?: SortOrderInput | SortOrder
    verified?: SortOrder
    isPublic?: SortOrder
    previewSources?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    market?: MarketOrderByWithRelationInput
    copyTrades?: CopyTradeOrderByRelationAggregateInput
    subscriptions?: SubscriptionOrderByRelationAggregateInput
  }

  export type ReasoningTraceWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ReasoningTraceWhereInput | ReasoningTraceWhereInput[]
    OR?: ReasoningTraceWhereInput[]
    NOT?: ReasoningTraceWhereInput | ReasoningTraceWhereInput[]
    marketId?: StringFilter<"ReasoningTrace"> | string
    agentType?: EnumAgentTypeFilter<"ReasoningTrace"> | $Enums.AgentType
    decisionType?: StringFilter<"ReasoningTrace"> | string
    sourcesUsed?: JsonFilter<"ReasoningTrace">
    probabilityEstimate?: FloatFilter<"ReasoningTrace"> | number
    marketProbability?: FloatFilter<"ReasoningTrace"> | number
    edge?: FloatFilter<"ReasoningTrace"> | number
    confidenceInterval?: JsonFilter<"ReasoningTrace">
    betFraction?: FloatNullableFilter<"ReasoningTrace"> | number | null
    betSizeUsdc?: FloatNullableFilter<"ReasoningTrace"> | number | null
    hedgeConditions?: JsonNullableFilter<"ReasoningTrace">
    agentWallet?: StringNullableFilter<"ReasoningTrace"> | string | null
    signature?: StringNullableFilter<"ReasoningTrace"> | string | null
    ipfsCid?: StringNullableFilter<"ReasoningTrace"> | string | null
    sha256Hash?: StringNullableFilter<"ReasoningTrace"> | string | null
    onChainTxHash?: StringNullableFilter<"ReasoningTrace"> | string | null
    verified?: BoolFilter<"ReasoningTrace"> | boolean
    isPublic?: BoolFilter<"ReasoningTrace"> | boolean
    previewSources?: JsonNullableFilter<"ReasoningTrace">
    createdAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
    updatedAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    copyTrades?: CopyTradeListRelationFilter
    subscriptions?: SubscriptionListRelationFilter
  }, "id">

  export type ReasoningTraceOrderByWithAggregationInput = {
    id?: SortOrder
    marketId?: SortOrder
    agentType?: SortOrder
    decisionType?: SortOrder
    sourcesUsed?: SortOrder
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    confidenceInterval?: SortOrder
    betFraction?: SortOrderInput | SortOrder
    betSizeUsdc?: SortOrderInput | SortOrder
    hedgeConditions?: SortOrderInput | SortOrder
    agentWallet?: SortOrderInput | SortOrder
    signature?: SortOrderInput | SortOrder
    ipfsCid?: SortOrderInput | SortOrder
    sha256Hash?: SortOrderInput | SortOrder
    onChainTxHash?: SortOrderInput | SortOrder
    verified?: SortOrder
    isPublic?: SortOrder
    previewSources?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ReasoningTraceCountOrderByAggregateInput
    _avg?: ReasoningTraceAvgOrderByAggregateInput
    _max?: ReasoningTraceMaxOrderByAggregateInput
    _min?: ReasoningTraceMinOrderByAggregateInput
    _sum?: ReasoningTraceSumOrderByAggregateInput
  }

  export type ReasoningTraceScalarWhereWithAggregatesInput = {
    AND?: ReasoningTraceScalarWhereWithAggregatesInput | ReasoningTraceScalarWhereWithAggregatesInput[]
    OR?: ReasoningTraceScalarWhereWithAggregatesInput[]
    NOT?: ReasoningTraceScalarWhereWithAggregatesInput | ReasoningTraceScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ReasoningTrace"> | string
    marketId?: StringWithAggregatesFilter<"ReasoningTrace"> | string
    agentType?: EnumAgentTypeWithAggregatesFilter<"ReasoningTrace"> | $Enums.AgentType
    decisionType?: StringWithAggregatesFilter<"ReasoningTrace"> | string
    sourcesUsed?: JsonWithAggregatesFilter<"ReasoningTrace">
    probabilityEstimate?: FloatWithAggregatesFilter<"ReasoningTrace"> | number
    marketProbability?: FloatWithAggregatesFilter<"ReasoningTrace"> | number
    edge?: FloatWithAggregatesFilter<"ReasoningTrace"> | number
    confidenceInterval?: JsonWithAggregatesFilter<"ReasoningTrace">
    betFraction?: FloatNullableWithAggregatesFilter<"ReasoningTrace"> | number | null
    betSizeUsdc?: FloatNullableWithAggregatesFilter<"ReasoningTrace"> | number | null
    hedgeConditions?: JsonNullableWithAggregatesFilter<"ReasoningTrace">
    agentWallet?: StringNullableWithAggregatesFilter<"ReasoningTrace"> | string | null
    signature?: StringNullableWithAggregatesFilter<"ReasoningTrace"> | string | null
    ipfsCid?: StringNullableWithAggregatesFilter<"ReasoningTrace"> | string | null
    sha256Hash?: StringNullableWithAggregatesFilter<"ReasoningTrace"> | string | null
    onChainTxHash?: StringNullableWithAggregatesFilter<"ReasoningTrace"> | string | null
    verified?: BoolWithAggregatesFilter<"ReasoningTrace"> | boolean
    isPublic?: BoolWithAggregatesFilter<"ReasoningTrace"> | boolean
    previewSources?: JsonNullableWithAggregatesFilter<"ReasoningTrace">
    createdAt?: DateTimeWithAggregatesFilter<"ReasoningTrace"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"ReasoningTrace"> | Date | string
  }

  export type CopyTradeWhereInput = {
    AND?: CopyTradeWhereInput | CopyTradeWhereInput[]
    OR?: CopyTradeWhereInput[]
    NOT?: CopyTradeWhereInput | CopyTradeWhereInput[]
    id?: StringFilter<"CopyTrade"> | string
    userId?: StringFilter<"CopyTrade"> | string
    traceId?: StringFilter<"CopyTrade"> | string
    marketId?: StringFilter<"CopyTrade"> | string
    tradeId?: StringNullableFilter<"CopyTrade"> | string | null
    direction?: EnumTradeDirectionFilter<"CopyTrade"> | $Enums.TradeDirection
    amount?: FloatFilter<"CopyTrade"> | number
    txHash?: StringNullableFilter<"CopyTrade"> | string | null
    builderFee?: FloatFilter<"CopyTrade"> | number
    status?: EnumTradeStatusFilter<"CopyTrade"> | $Enums.TradeStatus
    pnl?: FloatNullableFilter<"CopyTrade"> | number | null
    createdAt?: DateTimeFilter<"CopyTrade"> | Date | string
    updatedAt?: DateTimeFilter<"CopyTrade"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
    trace?: XOR<ReasoningTraceScalarRelationFilter, ReasoningTraceWhereInput>
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    trade?: XOR<TradeNullableScalarRelationFilter, TradeWhereInput> | null
  }

  export type CopyTradeOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrderInput | SortOrder
    direction?: SortOrder
    amount?: SortOrder
    txHash?: SortOrderInput | SortOrder
    builderFee?: SortOrder
    status?: SortOrder
    pnl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    user?: UserOrderByWithRelationInput
    trace?: ReasoningTraceOrderByWithRelationInput
    market?: MarketOrderByWithRelationInput
    trade?: TradeOrderByWithRelationInput
  }

  export type CopyTradeWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: CopyTradeWhereInput | CopyTradeWhereInput[]
    OR?: CopyTradeWhereInput[]
    NOT?: CopyTradeWhereInput | CopyTradeWhereInput[]
    userId?: StringFilter<"CopyTrade"> | string
    traceId?: StringFilter<"CopyTrade"> | string
    marketId?: StringFilter<"CopyTrade"> | string
    tradeId?: StringNullableFilter<"CopyTrade"> | string | null
    direction?: EnumTradeDirectionFilter<"CopyTrade"> | $Enums.TradeDirection
    amount?: FloatFilter<"CopyTrade"> | number
    txHash?: StringNullableFilter<"CopyTrade"> | string | null
    builderFee?: FloatFilter<"CopyTrade"> | number
    status?: EnumTradeStatusFilter<"CopyTrade"> | $Enums.TradeStatus
    pnl?: FloatNullableFilter<"CopyTrade"> | number | null
    createdAt?: DateTimeFilter<"CopyTrade"> | Date | string
    updatedAt?: DateTimeFilter<"CopyTrade"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
    trace?: XOR<ReasoningTraceScalarRelationFilter, ReasoningTraceWhereInput>
    market?: XOR<MarketScalarRelationFilter, MarketWhereInput>
    trade?: XOR<TradeNullableScalarRelationFilter, TradeWhereInput> | null
  }, "id">

  export type CopyTradeOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrderInput | SortOrder
    direction?: SortOrder
    amount?: SortOrder
    txHash?: SortOrderInput | SortOrder
    builderFee?: SortOrder
    status?: SortOrder
    pnl?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: CopyTradeCountOrderByAggregateInput
    _avg?: CopyTradeAvgOrderByAggregateInput
    _max?: CopyTradeMaxOrderByAggregateInput
    _min?: CopyTradeMinOrderByAggregateInput
    _sum?: CopyTradeSumOrderByAggregateInput
  }

  export type CopyTradeScalarWhereWithAggregatesInput = {
    AND?: CopyTradeScalarWhereWithAggregatesInput | CopyTradeScalarWhereWithAggregatesInput[]
    OR?: CopyTradeScalarWhereWithAggregatesInput[]
    NOT?: CopyTradeScalarWhereWithAggregatesInput | CopyTradeScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"CopyTrade"> | string
    userId?: StringWithAggregatesFilter<"CopyTrade"> | string
    traceId?: StringWithAggregatesFilter<"CopyTrade"> | string
    marketId?: StringWithAggregatesFilter<"CopyTrade"> | string
    tradeId?: StringNullableWithAggregatesFilter<"CopyTrade"> | string | null
    direction?: EnumTradeDirectionWithAggregatesFilter<"CopyTrade"> | $Enums.TradeDirection
    amount?: FloatWithAggregatesFilter<"CopyTrade"> | number
    txHash?: StringNullableWithAggregatesFilter<"CopyTrade"> | string | null
    builderFee?: FloatWithAggregatesFilter<"CopyTrade"> | number
    status?: EnumTradeStatusWithAggregatesFilter<"CopyTrade"> | $Enums.TradeStatus
    pnl?: FloatNullableWithAggregatesFilter<"CopyTrade"> | number | null
    createdAt?: DateTimeWithAggregatesFilter<"CopyTrade"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"CopyTrade"> | Date | string
  }

  export type SubscriptionWhereInput = {
    AND?: SubscriptionWhereInput | SubscriptionWhereInput[]
    OR?: SubscriptionWhereInput[]
    NOT?: SubscriptionWhereInput | SubscriptionWhereInput[]
    id?: StringFilter<"Subscription"> | string
    userId?: StringFilter<"Subscription"> | string
    traceId?: StringNullableFilter<"Subscription"> | string | null
    type?: EnumSubscriptionTypeFilter<"Subscription"> | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    amountPaid?: FloatFilter<"Subscription"> | number
    currency?: StringFilter<"Subscription"> | string
    txHash?: StringNullableFilter<"Subscription"> | string | null
    expiresAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    updatedAt?: DateTimeFilter<"Subscription"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
    trace?: XOR<ReasoningTraceNullableScalarRelationFilter, ReasoningTraceWhereInput> | null
  }

  export type SubscriptionOrderByWithRelationInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrderInput | SortOrder
    type?: SortOrder
    status?: SortOrder
    amountPaid?: SortOrder
    currency?: SortOrder
    txHash?: SortOrderInput | SortOrder
    expiresAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    user?: UserOrderByWithRelationInput
    trace?: ReasoningTraceOrderByWithRelationInput
  }

  export type SubscriptionWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: SubscriptionWhereInput | SubscriptionWhereInput[]
    OR?: SubscriptionWhereInput[]
    NOT?: SubscriptionWhereInput | SubscriptionWhereInput[]
    userId?: StringFilter<"Subscription"> | string
    traceId?: StringNullableFilter<"Subscription"> | string | null
    type?: EnumSubscriptionTypeFilter<"Subscription"> | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    amountPaid?: FloatFilter<"Subscription"> | number
    currency?: StringFilter<"Subscription"> | string
    txHash?: StringNullableFilter<"Subscription"> | string | null
    expiresAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    updatedAt?: DateTimeFilter<"Subscription"> | Date | string
    user?: XOR<UserScalarRelationFilter, UserWhereInput>
    trace?: XOR<ReasoningTraceNullableScalarRelationFilter, ReasoningTraceWhereInput> | null
  }, "id">

  export type SubscriptionOrderByWithAggregationInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrderInput | SortOrder
    type?: SortOrder
    status?: SortOrder
    amountPaid?: SortOrder
    currency?: SortOrder
    txHash?: SortOrderInput | SortOrder
    expiresAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: SubscriptionCountOrderByAggregateInput
    _avg?: SubscriptionAvgOrderByAggregateInput
    _max?: SubscriptionMaxOrderByAggregateInput
    _min?: SubscriptionMinOrderByAggregateInput
    _sum?: SubscriptionSumOrderByAggregateInput
  }

  export type SubscriptionScalarWhereWithAggregatesInput = {
    AND?: SubscriptionScalarWhereWithAggregatesInput | SubscriptionScalarWhereWithAggregatesInput[]
    OR?: SubscriptionScalarWhereWithAggregatesInput[]
    NOT?: SubscriptionScalarWhereWithAggregatesInput | SubscriptionScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Subscription"> | string
    userId?: StringWithAggregatesFilter<"Subscription"> | string
    traceId?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    type?: EnumSubscriptionTypeWithAggregatesFilter<"Subscription"> | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusWithAggregatesFilter<"Subscription"> | $Enums.SubscriptionStatus
    amountPaid?: FloatWithAggregatesFilter<"Subscription"> | number
    currency?: StringWithAggregatesFilter<"Subscription"> | string
    txHash?: StringNullableWithAggregatesFilter<"Subscription"> | string | null
    expiresAt?: DateTimeNullableWithAggregatesFilter<"Subscription"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Subscription"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Subscription"> | Date | string
  }

  export type AgentLogWhereInput = {
    AND?: AgentLogWhereInput | AgentLogWhereInput[]
    OR?: AgentLogWhereInput[]
    NOT?: AgentLogWhereInput | AgentLogWhereInput[]
    id?: StringFilter<"AgentLog"> | string
    agentType?: EnumAgentTypeFilter<"AgentLog"> | $Enums.AgentType
    level?: EnumLogLevelFilter<"AgentLog"> | $Enums.LogLevel
    action?: StringFilter<"AgentLog"> | string
    marketId?: StringNullableFilter<"AgentLog"> | string | null
    data?: JsonNullableFilter<"AgentLog">
    error?: StringNullableFilter<"AgentLog"> | string | null
    createdAt?: DateTimeFilter<"AgentLog"> | Date | string
    market?: XOR<MarketNullableScalarRelationFilter, MarketWhereInput> | null
  }

  export type AgentLogOrderByWithRelationInput = {
    id?: SortOrder
    agentType?: SortOrder
    level?: SortOrder
    action?: SortOrder
    marketId?: SortOrderInput | SortOrder
    data?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    market?: MarketOrderByWithRelationInput
  }

  export type AgentLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AgentLogWhereInput | AgentLogWhereInput[]
    OR?: AgentLogWhereInput[]
    NOT?: AgentLogWhereInput | AgentLogWhereInput[]
    agentType?: EnumAgentTypeFilter<"AgentLog"> | $Enums.AgentType
    level?: EnumLogLevelFilter<"AgentLog"> | $Enums.LogLevel
    action?: StringFilter<"AgentLog"> | string
    marketId?: StringNullableFilter<"AgentLog"> | string | null
    data?: JsonNullableFilter<"AgentLog">
    error?: StringNullableFilter<"AgentLog"> | string | null
    createdAt?: DateTimeFilter<"AgentLog"> | Date | string
    market?: XOR<MarketNullableScalarRelationFilter, MarketWhereInput> | null
  }, "id">

  export type AgentLogOrderByWithAggregationInput = {
    id?: SortOrder
    agentType?: SortOrder
    level?: SortOrder
    action?: SortOrder
    marketId?: SortOrderInput | SortOrder
    data?: SortOrderInput | SortOrder
    error?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: AgentLogCountOrderByAggregateInput
    _max?: AgentLogMaxOrderByAggregateInput
    _min?: AgentLogMinOrderByAggregateInput
  }

  export type AgentLogScalarWhereWithAggregatesInput = {
    AND?: AgentLogScalarWhereWithAggregatesInput | AgentLogScalarWhereWithAggregatesInput[]
    OR?: AgentLogScalarWhereWithAggregatesInput[]
    NOT?: AgentLogScalarWhereWithAggregatesInput | AgentLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AgentLog"> | string
    agentType?: EnumAgentTypeWithAggregatesFilter<"AgentLog"> | $Enums.AgentType
    level?: EnumLogLevelWithAggregatesFilter<"AgentLog"> | $Enums.LogLevel
    action?: StringWithAggregatesFilter<"AgentLog"> | string
    marketId?: StringNullableWithAggregatesFilter<"AgentLog"> | string | null
    data?: JsonNullableWithAggregatesFilter<"AgentLog">
    error?: StringNullableWithAggregatesFilter<"AgentLog"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"AgentLog"> | Date | string
  }

  export type SignalCacheWhereInput = {
    AND?: SignalCacheWhereInput | SignalCacheWhereInput[]
    OR?: SignalCacheWhereInput[]
    NOT?: SignalCacheWhereInput | SignalCacheWhereInput[]
    id?: StringFilter<"SignalCache"> | string
    source?: StringFilter<"SignalCache"> | string
    payload?: JsonFilter<"SignalCache">
    fetchedAt?: DateTimeFilter<"SignalCache"> | Date | string
    expiresAt?: DateTimeFilter<"SignalCache"> | Date | string
  }

  export type SignalCacheOrderByWithRelationInput = {
    id?: SortOrder
    source?: SortOrder
    payload?: SortOrder
    fetchedAt?: SortOrder
    expiresAt?: SortOrder
  }

  export type SignalCacheWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: SignalCacheWhereInput | SignalCacheWhereInput[]
    OR?: SignalCacheWhereInput[]
    NOT?: SignalCacheWhereInput | SignalCacheWhereInput[]
    source?: StringFilter<"SignalCache"> | string
    payload?: JsonFilter<"SignalCache">
    fetchedAt?: DateTimeFilter<"SignalCache"> | Date | string
    expiresAt?: DateTimeFilter<"SignalCache"> | Date | string
  }, "id">

  export type SignalCacheOrderByWithAggregationInput = {
    id?: SortOrder
    source?: SortOrder
    payload?: SortOrder
    fetchedAt?: SortOrder
    expiresAt?: SortOrder
    _count?: SignalCacheCountOrderByAggregateInput
    _max?: SignalCacheMaxOrderByAggregateInput
    _min?: SignalCacheMinOrderByAggregateInput
  }

  export type SignalCacheScalarWhereWithAggregatesInput = {
    AND?: SignalCacheScalarWhereWithAggregatesInput | SignalCacheScalarWhereWithAggregatesInput[]
    OR?: SignalCacheScalarWhereWithAggregatesInput[]
    NOT?: SignalCacheScalarWhereWithAggregatesInput | SignalCacheScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"SignalCache"> | string
    source?: StringWithAggregatesFilter<"SignalCache"> | string
    payload?: JsonWithAggregatesFilter<"SignalCache">
    fetchedAt?: DateTimeWithAggregatesFilter<"SignalCache"> | Date | string
    expiresAt?: DateTimeWithAggregatesFilter<"SignalCache"> | Date | string
  }

  export type BlockIndexWhereInput = {
    AND?: BlockIndexWhereInput | BlockIndexWhereInput[]
    OR?: BlockIndexWhereInput[]
    NOT?: BlockIndexWhereInput | BlockIndexWhereInput[]
    id?: StringFilter<"BlockIndex"> | string
    chainId?: IntFilter<"BlockIndex"> | number
    lastBlockNumber?: BigIntFilter<"BlockIndex"> | bigint | number
    updatedAt?: DateTimeFilter<"BlockIndex"> | Date | string
  }

  export type BlockIndexOrderByWithRelationInput = {
    id?: SortOrder
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
    updatedAt?: SortOrder
  }

  export type BlockIndexWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    chainId?: number
    AND?: BlockIndexWhereInput | BlockIndexWhereInput[]
    OR?: BlockIndexWhereInput[]
    NOT?: BlockIndexWhereInput | BlockIndexWhereInput[]
    lastBlockNumber?: BigIntFilter<"BlockIndex"> | bigint | number
    updatedAt?: DateTimeFilter<"BlockIndex"> | Date | string
  }, "id" | "chainId">

  export type BlockIndexOrderByWithAggregationInput = {
    id?: SortOrder
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
    updatedAt?: SortOrder
    _count?: BlockIndexCountOrderByAggregateInput
    _avg?: BlockIndexAvgOrderByAggregateInput
    _max?: BlockIndexMaxOrderByAggregateInput
    _min?: BlockIndexMinOrderByAggregateInput
    _sum?: BlockIndexSumOrderByAggregateInput
  }

  export type BlockIndexScalarWhereWithAggregatesInput = {
    AND?: BlockIndexScalarWhereWithAggregatesInput | BlockIndexScalarWhereWithAggregatesInput[]
    OR?: BlockIndexScalarWhereWithAggregatesInput[]
    NOT?: BlockIndexScalarWhereWithAggregatesInput | BlockIndexScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"BlockIndex"> | string
    chainId?: IntWithAggregatesFilter<"BlockIndex"> | number
    lastBlockNumber?: BigIntWithAggregatesFilter<"BlockIndex"> | bigint | number
    updatedAt?: DateTimeWithAggregatesFilter<"BlockIndex"> | Date | string
  }

  export type UserCreateInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionCreateNestedManyWithoutUserInput
    copyTrades?: CopyTradeCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutUserInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUpdateManyWithoutUserNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutUserNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutUserNestedInput
  }

  export type UserCreateManyInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MarketCreateInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeCreateNestedManyWithoutMarketInput
    positions?: PositionCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeUncheckedCreateNestedManyWithoutMarketInput
    positions?: PositionUncheckedCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUpdateManyWithoutMarketNestedInput
    positions?: PositionUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUncheckedUpdateManyWithoutMarketNestedInput
    positions?: PositionUncheckedUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type MarketCreateManyInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MarketUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MarketUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TradeCreateInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutTradesInput
    position?: PositionCreateNestedOneWithoutTradeInput
    copyTrades?: CopyTradeCreateNestedManyWithoutTradeInput
  }

  export type TradeUncheckedCreateInput = {
    id?: string
    marketId: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    position?: PositionUncheckedCreateNestedOneWithoutTradeInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTradeInput
  }

  export type TradeUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutTradesNestedInput
    position?: PositionUpdateOneWithoutTradeNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutTradeNestedInput
  }

  export type TradeUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    position?: PositionUncheckedUpdateOneWithoutTradeNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTradeNestedInput
  }

  export type TradeCreateManyInput = {
    id?: string
    marketId: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TradeUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TradeUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PositionCreateInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutPositionsInput
    trade: TradeCreateNestedOneWithoutPositionInput
  }

  export type PositionUncheckedCreateInput = {
    id?: string
    marketId: string
    tradeId: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PositionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutPositionsNestedInput
    trade?: TradeUpdateOneRequiredWithoutPositionNestedInput
  }

  export type PositionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PositionCreateManyInput = {
    id?: string
    marketId: string
    tradeId: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PositionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PositionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReasoningTraceCreateInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutReasoningTracesInput
    copyTrades?: CopyTradeCreateNestedManyWithoutTraceInput
    subscriptions?: SubscriptionCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceUncheckedCreateInput = {
    id?: string
    marketId: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTraceInput
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutReasoningTracesNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutTraceNestedInput
    subscriptions?: SubscriptionUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTraceNestedInput
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceCreateManyInput = {
    id?: string
    marketId: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReasoningTraceUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReasoningTraceUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeCreateInput = {
    id?: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutCopyTradesInput
    trace: ReasoningTraceCreateNestedOneWithoutCopyTradesInput
    market: MarketCreateNestedOneWithoutCopyTradesInput
    trade?: TradeCreateNestedOneWithoutCopyTradesInput
  }

  export type CopyTradeUncheckedCreateInput = {
    id?: string
    userId: string
    traceId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutCopyTradesNestedInput
    trace?: ReasoningTraceUpdateOneRequiredWithoutCopyTradesNestedInput
    market?: MarketUpdateOneRequiredWithoutCopyTradesNestedInput
    trade?: TradeUpdateOneWithoutCopyTradesNestedInput
  }

  export type CopyTradeUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeCreateManyInput = {
    id?: string
    userId: string
    traceId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionCreateInput = {
    id?: string
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutSubscriptionsInput
    trace?: ReasoningTraceCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateInput = {
    id?: string
    userId: string
    traceId?: string | null
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutSubscriptionsNestedInput
    trace?: ReasoningTraceUpdateOneWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionCreateManyInput = {
    id?: string
    userId: string
    traceId?: string | null
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogCreateInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
    market?: MarketCreateNestedOneWithoutAgentLogsInput
  }

  export type AgentLogUncheckedCreateInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    marketId?: string | null
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
  }

  export type AgentLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneWithoutAgentLogsNestedInput
  }

  export type AgentLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    marketId?: NullableStringFieldUpdateOperationsInput | string | null
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogCreateManyInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    marketId?: string | null
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
  }

  export type AgentLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    marketId?: NullableStringFieldUpdateOperationsInput | string | null
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SignalCacheCreateInput = {
    id?: string
    source: string
    payload: JsonNullValueInput | InputJsonValue
    fetchedAt?: Date | string
    expiresAt: Date | string
  }

  export type SignalCacheUncheckedCreateInput = {
    id?: string
    source: string
    payload: JsonNullValueInput | InputJsonValue
    fetchedAt?: Date | string
    expiresAt: Date | string
  }

  export type SignalCacheUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    payload?: JsonNullValueInput | InputJsonValue
    fetchedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SignalCacheUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    payload?: JsonNullValueInput | InputJsonValue
    fetchedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SignalCacheCreateManyInput = {
    id?: string
    source: string
    payload: JsonNullValueInput | InputJsonValue
    fetchedAt?: Date | string
    expiresAt: Date | string
  }

  export type SignalCacheUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    payload?: JsonNullValueInput | InputJsonValue
    fetchedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SignalCacheUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    payload?: JsonNullValueInput | InputJsonValue
    fetchedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BlockIndexCreateInput = {
    id?: string
    chainId: number
    lastBlockNumber?: bigint | number
    updatedAt?: Date | string
  }

  export type BlockIndexUncheckedCreateInput = {
    id?: string
    chainId: number
    lastBlockNumber?: bigint | number
    updatedAt?: Date | string
  }

  export type BlockIndexUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    chainId?: IntFieldUpdateOperationsInput | number
    lastBlockNumber?: BigIntFieldUpdateOperationsInput | bigint | number
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BlockIndexUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    chainId?: IntFieldUpdateOperationsInput | number
    lastBlockNumber?: BigIntFieldUpdateOperationsInput | bigint | number
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BlockIndexCreateManyInput = {
    id?: string
    chainId: number
    lastBlockNumber?: bigint | number
    updatedAt?: Date | string
  }

  export type BlockIndexUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    chainId?: IntFieldUpdateOperationsInput | number
    lastBlockNumber?: BigIntFieldUpdateOperationsInput | bigint | number
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BlockIndexUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    chainId?: IntFieldUpdateOperationsInput | number
    lastBlockNumber?: BigIntFieldUpdateOperationsInput | bigint | number
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type SubscriptionListRelationFilter = {
    every?: SubscriptionWhereInput
    some?: SubscriptionWhereInput
    none?: SubscriptionWhereInput
  }

  export type CopyTradeListRelationFilter = {
    every?: CopyTradeWhereInput
    some?: CopyTradeWhereInput
    none?: CopyTradeWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type SubscriptionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type CopyTradeOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type UserCountOrderByAggregateInput = {
    id?: SortOrder
    walletAddress?: SortOrder
    email?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    id?: SortOrder
    walletAddress?: SortOrder
    email?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    id?: SortOrder
    walletAddress?: SortOrder
    email?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type EnumMarketCategoryFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketCategory | EnumMarketCategoryFieldRefInput<$PrismaModel>
    in?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketCategoryFilter<$PrismaModel> | $Enums.MarketCategory
  }

  export type EnumMarketStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketStatus | EnumMarketStatusFieldRefInput<$PrismaModel>
    in?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketStatusFilter<$PrismaModel> | $Enums.MarketStatus
  }

  export type EnumSettlementCurrencyFilter<$PrismaModel = never> = {
    equals?: $Enums.SettlementCurrency | EnumSettlementCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumSettlementCurrencyFilter<$PrismaModel> | $Enums.SettlementCurrency
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }
  export type JsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type TradeListRelationFilter = {
    every?: TradeWhereInput
    some?: TradeWhereInput
    none?: TradeWhereInput
  }

  export type PositionListRelationFilter = {
    every?: PositionWhereInput
    some?: PositionWhereInput
    none?: PositionWhereInput
  }

  export type ReasoningTraceListRelationFilter = {
    every?: ReasoningTraceWhereInput
    some?: ReasoningTraceWhereInput
    none?: ReasoningTraceWhereInput
  }

  export type AgentLogListRelationFilter = {
    every?: AgentLogWhereInput
    some?: AgentLogWhereInput
    none?: AgentLogWhereInput
  }

  export type TradeOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type PositionOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ReasoningTraceOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AgentLogOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MarketCountOrderByAggregateInput = {
    id?: SortOrder
    question?: SortOrder
    category?: SortOrder
    status?: SortOrder
    settlementCurrency?: SortOrder
    initialYesProb?: SortOrder
    currentYesProb?: SortOrder
    confidenceInterval?: SortOrder
    expiryTimestamp?: SortOrder
    resolutionOracle?: SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
    onChainAddress?: SortOrder
    txHash?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketAvgOrderByAggregateInput = {
    initialYesProb?: SortOrder
    currentYesProb?: SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
  }

  export type MarketMaxOrderByAggregateInput = {
    id?: SortOrder
    question?: SortOrder
    category?: SortOrder
    status?: SortOrder
    settlementCurrency?: SortOrder
    initialYesProb?: SortOrder
    currentYesProb?: SortOrder
    expiryTimestamp?: SortOrder
    resolutionOracle?: SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
    onChainAddress?: SortOrder
    txHash?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketMinOrderByAggregateInput = {
    id?: SortOrder
    question?: SortOrder
    category?: SortOrder
    status?: SortOrder
    settlementCurrency?: SortOrder
    initialYesProb?: SortOrder
    currentYesProb?: SortOrder
    expiryTimestamp?: SortOrder
    resolutionOracle?: SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
    onChainAddress?: SortOrder
    txHash?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketSumOrderByAggregateInput = {
    initialYesProb?: SortOrder
    currentYesProb?: SortOrder
    minimumLiquidity?: SortOrder
    totalLiquidity?: SortOrder
  }

  export type EnumMarketCategoryWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketCategory | EnumMarketCategoryFieldRefInput<$PrismaModel>
    in?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketCategoryWithAggregatesFilter<$PrismaModel> | $Enums.MarketCategory
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMarketCategoryFilter<$PrismaModel>
    _max?: NestedEnumMarketCategoryFilter<$PrismaModel>
  }

  export type EnumMarketStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketStatus | EnumMarketStatusFieldRefInput<$PrismaModel>
    in?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketStatusWithAggregatesFilter<$PrismaModel> | $Enums.MarketStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMarketStatusFilter<$PrismaModel>
    _max?: NestedEnumMarketStatusFilter<$PrismaModel>
  }

  export type EnumSettlementCurrencyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SettlementCurrency | EnumSettlementCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumSettlementCurrencyWithAggregatesFilter<$PrismaModel> | $Enums.SettlementCurrency
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSettlementCurrencyFilter<$PrismaModel>
    _max?: NestedEnumSettlementCurrencyFilter<$PrismaModel>
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type EnumTradeDirectionFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeDirection | EnumTradeDirectionFieldRefInput<$PrismaModel>
    in?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeDirectionFilter<$PrismaModel> | $Enums.TradeDirection
  }

  export type EnumTradeStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeStatus | EnumTradeStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeStatusFilter<$PrismaModel> | $Enums.TradeStatus
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type MarketScalarRelationFilter = {
    is?: MarketWhereInput
    isNot?: MarketWhereInput
  }

  export type PositionNullableScalarRelationFilter = {
    is?: PositionWhereInput | null
    isNot?: PositionWhereInput | null
  }

  export type TradeCountOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    errorMessage?: SortOrder
    executedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TradeAvgOrderByAggregateInput = {
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    builderFee?: SortOrder
  }

  export type TradeMaxOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    errorMessage?: SortOrder
    executedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TradeMinOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    errorMessage?: SortOrder
    executedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TradeSumOrderByAggregateInput = {
    amount?: SortOrder
    price?: SortOrder
    edgeDetected?: SortOrder
    kellyFraction?: SortOrder
    builderFee?: SortOrder
  }

  export type EnumTradeDirectionWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeDirection | EnumTradeDirectionFieldRefInput<$PrismaModel>
    in?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeDirectionWithAggregatesFilter<$PrismaModel> | $Enums.TradeDirection
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTradeDirectionFilter<$PrismaModel>
    _max?: NestedEnumTradeDirectionFilter<$PrismaModel>
  }

  export type EnumTradeStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeStatus | EnumTradeStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeStatusWithAggregatesFilter<$PrismaModel> | $Enums.TradeStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTradeStatusFilter<$PrismaModel>
    _max?: NestedEnumTradeStatusFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type EnumPositionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PositionStatus | EnumPositionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPositionStatusFilter<$PrismaModel> | $Enums.PositionStatus
  }

  export type TradeScalarRelationFilter = {
    is?: TradeWhereInput
    isNot?: TradeWhereInput
  }

  export type PositionCountOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    entryPrice?: SortOrder
    currentPrice?: SortOrder
    size?: SortOrder
    pnl?: SortOrder
    hedgeMarketId?: SortOrder
    closedAt?: SortOrder
    closeReason?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PositionAvgOrderByAggregateInput = {
    entryPrice?: SortOrder
    currentPrice?: SortOrder
    size?: SortOrder
    pnl?: SortOrder
  }

  export type PositionMaxOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    entryPrice?: SortOrder
    currentPrice?: SortOrder
    size?: SortOrder
    pnl?: SortOrder
    hedgeMarketId?: SortOrder
    closedAt?: SortOrder
    closeReason?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PositionMinOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    status?: SortOrder
    entryPrice?: SortOrder
    currentPrice?: SortOrder
    size?: SortOrder
    pnl?: SortOrder
    hedgeMarketId?: SortOrder
    closedAt?: SortOrder
    closeReason?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type PositionSumOrderByAggregateInput = {
    entryPrice?: SortOrder
    currentPrice?: SortOrder
    size?: SortOrder
    pnl?: SortOrder
  }

  export type EnumPositionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PositionStatus | EnumPositionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPositionStatusWithAggregatesFilter<$PrismaModel> | $Enums.PositionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPositionStatusFilter<$PrismaModel>
    _max?: NestedEnumPositionStatusFilter<$PrismaModel>
  }

  export type EnumAgentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AgentType | EnumAgentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAgentTypeFilter<$PrismaModel> | $Enums.AgentType
  }
  export type JsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type ReasoningTraceCountOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    agentType?: SortOrder
    decisionType?: SortOrder
    sourcesUsed?: SortOrder
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    confidenceInterval?: SortOrder
    betFraction?: SortOrder
    betSizeUsdc?: SortOrder
    hedgeConditions?: SortOrder
    agentWallet?: SortOrder
    signature?: SortOrder
    ipfsCid?: SortOrder
    sha256Hash?: SortOrder
    onChainTxHash?: SortOrder
    verified?: SortOrder
    isPublic?: SortOrder
    previewSources?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReasoningTraceAvgOrderByAggregateInput = {
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    betFraction?: SortOrder
    betSizeUsdc?: SortOrder
  }

  export type ReasoningTraceMaxOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    agentType?: SortOrder
    decisionType?: SortOrder
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    betFraction?: SortOrder
    betSizeUsdc?: SortOrder
    agentWallet?: SortOrder
    signature?: SortOrder
    ipfsCid?: SortOrder
    sha256Hash?: SortOrder
    onChainTxHash?: SortOrder
    verified?: SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReasoningTraceMinOrderByAggregateInput = {
    id?: SortOrder
    marketId?: SortOrder
    agentType?: SortOrder
    decisionType?: SortOrder
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    betFraction?: SortOrder
    betSizeUsdc?: SortOrder
    agentWallet?: SortOrder
    signature?: SortOrder
    ipfsCid?: SortOrder
    sha256Hash?: SortOrder
    onChainTxHash?: SortOrder
    verified?: SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ReasoningTraceSumOrderByAggregateInput = {
    probabilityEstimate?: SortOrder
    marketProbability?: SortOrder
    edge?: SortOrder
    betFraction?: SortOrder
    betSizeUsdc?: SortOrder
  }

  export type EnumAgentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AgentType | EnumAgentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAgentTypeWithAggregatesFilter<$PrismaModel> | $Enums.AgentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAgentTypeFilter<$PrismaModel>
    _max?: NestedEnumAgentTypeFilter<$PrismaModel>
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type UserScalarRelationFilter = {
    is?: UserWhereInput
    isNot?: UserWhereInput
  }

  export type ReasoningTraceScalarRelationFilter = {
    is?: ReasoningTraceWhereInput
    isNot?: ReasoningTraceWhereInput
  }

  export type TradeNullableScalarRelationFilter = {
    is?: TradeWhereInput | null
    isNot?: TradeWhereInput | null
  }

  export type CopyTradeCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    amount?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    status?: SortOrder
    pnl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type CopyTradeAvgOrderByAggregateInput = {
    amount?: SortOrder
    builderFee?: SortOrder
    pnl?: SortOrder
  }

  export type CopyTradeMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    amount?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    status?: SortOrder
    pnl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type CopyTradeMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    marketId?: SortOrder
    tradeId?: SortOrder
    direction?: SortOrder
    amount?: SortOrder
    txHash?: SortOrder
    builderFee?: SortOrder
    status?: SortOrder
    pnl?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type CopyTradeSumOrderByAggregateInput = {
    amount?: SortOrder
    builderFee?: SortOrder
    pnl?: SortOrder
  }

  export type EnumSubscriptionTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionType | EnumSubscriptionTypeFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionTypeFilter<$PrismaModel> | $Enums.SubscriptionType
  }

  export type EnumSubscriptionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusFilter<$PrismaModel> | $Enums.SubscriptionStatus
  }

  export type ReasoningTraceNullableScalarRelationFilter = {
    is?: ReasoningTraceWhereInput | null
    isNot?: ReasoningTraceWhereInput | null
  }

  export type SubscriptionCountOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    type?: SortOrder
    status?: SortOrder
    amountPaid?: SortOrder
    currency?: SortOrder
    txHash?: SortOrder
    expiresAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SubscriptionAvgOrderByAggregateInput = {
    amountPaid?: SortOrder
  }

  export type SubscriptionMaxOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    type?: SortOrder
    status?: SortOrder
    amountPaid?: SortOrder
    currency?: SortOrder
    txHash?: SortOrder
    expiresAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SubscriptionMinOrderByAggregateInput = {
    id?: SortOrder
    userId?: SortOrder
    traceId?: SortOrder
    type?: SortOrder
    status?: SortOrder
    amountPaid?: SortOrder
    currency?: SortOrder
    txHash?: SortOrder
    expiresAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type SubscriptionSumOrderByAggregateInput = {
    amountPaid?: SortOrder
  }

  export type EnumSubscriptionTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionType | EnumSubscriptionTypeFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionTypeWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionTypeFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionTypeFilter<$PrismaModel>
  }

  export type EnumSubscriptionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
  }

  export type EnumLogLevelFilter<$PrismaModel = never> = {
    equals?: $Enums.LogLevel | EnumLogLevelFieldRefInput<$PrismaModel>
    in?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    notIn?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    not?: NestedEnumLogLevelFilter<$PrismaModel> | $Enums.LogLevel
  }

  export type MarketNullableScalarRelationFilter = {
    is?: MarketWhereInput | null
    isNot?: MarketWhereInput | null
  }

  export type AgentLogCountOrderByAggregateInput = {
    id?: SortOrder
    agentType?: SortOrder
    level?: SortOrder
    action?: SortOrder
    marketId?: SortOrder
    data?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
  }

  export type AgentLogMaxOrderByAggregateInput = {
    id?: SortOrder
    agentType?: SortOrder
    level?: SortOrder
    action?: SortOrder
    marketId?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
  }

  export type AgentLogMinOrderByAggregateInput = {
    id?: SortOrder
    agentType?: SortOrder
    level?: SortOrder
    action?: SortOrder
    marketId?: SortOrder
    error?: SortOrder
    createdAt?: SortOrder
  }

  export type EnumLogLevelWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LogLevel | EnumLogLevelFieldRefInput<$PrismaModel>
    in?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    notIn?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    not?: NestedEnumLogLevelWithAggregatesFilter<$PrismaModel> | $Enums.LogLevel
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLogLevelFilter<$PrismaModel>
    _max?: NestedEnumLogLevelFilter<$PrismaModel>
  }

  export type SignalCacheCountOrderByAggregateInput = {
    id?: SortOrder
    source?: SortOrder
    payload?: SortOrder
    fetchedAt?: SortOrder
    expiresAt?: SortOrder
  }

  export type SignalCacheMaxOrderByAggregateInput = {
    id?: SortOrder
    source?: SortOrder
    fetchedAt?: SortOrder
    expiresAt?: SortOrder
  }

  export type SignalCacheMinOrderByAggregateInput = {
    id?: SortOrder
    source?: SortOrder
    fetchedAt?: SortOrder
    expiresAt?: SortOrder
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type BigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type BlockIndexCountOrderByAggregateInput = {
    id?: SortOrder
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
    updatedAt?: SortOrder
  }

  export type BlockIndexAvgOrderByAggregateInput = {
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
  }

  export type BlockIndexMaxOrderByAggregateInput = {
    id?: SortOrder
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
    updatedAt?: SortOrder
  }

  export type BlockIndexMinOrderByAggregateInput = {
    id?: SortOrder
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
    updatedAt?: SortOrder
  }

  export type BlockIndexSumOrderByAggregateInput = {
    chainId?: SortOrder
    lastBlockNumber?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type BigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type SubscriptionCreateNestedManyWithoutUserInput = {
    create?: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput> | SubscriptionCreateWithoutUserInput[] | SubscriptionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutUserInput | SubscriptionCreateOrConnectWithoutUserInput[]
    createMany?: SubscriptionCreateManyUserInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type CopyTradeCreateNestedManyWithoutUserInput = {
    create?: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput> | CopyTradeCreateWithoutUserInput[] | CopyTradeUncheckedCreateWithoutUserInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutUserInput | CopyTradeCreateOrConnectWithoutUserInput[]
    createMany?: CopyTradeCreateManyUserInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput> | SubscriptionCreateWithoutUserInput[] | SubscriptionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutUserInput | SubscriptionCreateOrConnectWithoutUserInput[]
    createMany?: SubscriptionCreateManyUserInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type CopyTradeUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput> | CopyTradeCreateWithoutUserInput[] | CopyTradeUncheckedCreateWithoutUserInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutUserInput | CopyTradeCreateOrConnectWithoutUserInput[]
    createMany?: CopyTradeCreateManyUserInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type SubscriptionUpdateManyWithoutUserNestedInput = {
    create?: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput> | SubscriptionCreateWithoutUserInput[] | SubscriptionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutUserInput | SubscriptionCreateOrConnectWithoutUserInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutUserInput | SubscriptionUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: SubscriptionCreateManyUserInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutUserInput | SubscriptionUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutUserInput | SubscriptionUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type CopyTradeUpdateManyWithoutUserNestedInput = {
    create?: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput> | CopyTradeCreateWithoutUserInput[] | CopyTradeUncheckedCreateWithoutUserInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutUserInput | CopyTradeCreateOrConnectWithoutUserInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutUserInput | CopyTradeUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: CopyTradeCreateManyUserInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutUserInput | CopyTradeUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutUserInput | CopyTradeUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput> | SubscriptionCreateWithoutUserInput[] | SubscriptionUncheckedCreateWithoutUserInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutUserInput | SubscriptionCreateOrConnectWithoutUserInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutUserInput | SubscriptionUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: SubscriptionCreateManyUserInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutUserInput | SubscriptionUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutUserInput | SubscriptionUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type CopyTradeUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput> | CopyTradeCreateWithoutUserInput[] | CopyTradeUncheckedCreateWithoutUserInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutUserInput | CopyTradeCreateOrConnectWithoutUserInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutUserInput | CopyTradeUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: CopyTradeCreateManyUserInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutUserInput | CopyTradeUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutUserInput | CopyTradeUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type TradeCreateNestedManyWithoutMarketInput = {
    create?: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput> | TradeCreateWithoutMarketInput[] | TradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: TradeCreateOrConnectWithoutMarketInput | TradeCreateOrConnectWithoutMarketInput[]
    createMany?: TradeCreateManyMarketInputEnvelope
    connect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
  }

  export type PositionCreateNestedManyWithoutMarketInput = {
    create?: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput> | PositionCreateWithoutMarketInput[] | PositionUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: PositionCreateOrConnectWithoutMarketInput | PositionCreateOrConnectWithoutMarketInput[]
    createMany?: PositionCreateManyMarketInputEnvelope
    connect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
  }

  export type ReasoningTraceCreateNestedManyWithoutMarketInput = {
    create?: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput> | ReasoningTraceCreateWithoutMarketInput[] | ReasoningTraceUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutMarketInput | ReasoningTraceCreateOrConnectWithoutMarketInput[]
    createMany?: ReasoningTraceCreateManyMarketInputEnvelope
    connect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
  }

  export type CopyTradeCreateNestedManyWithoutMarketInput = {
    create?: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput> | CopyTradeCreateWithoutMarketInput[] | CopyTradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutMarketInput | CopyTradeCreateOrConnectWithoutMarketInput[]
    createMany?: CopyTradeCreateManyMarketInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type AgentLogCreateNestedManyWithoutMarketInput = {
    create?: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput> | AgentLogCreateWithoutMarketInput[] | AgentLogUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: AgentLogCreateOrConnectWithoutMarketInput | AgentLogCreateOrConnectWithoutMarketInput[]
    createMany?: AgentLogCreateManyMarketInputEnvelope
    connect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
  }

  export type TradeUncheckedCreateNestedManyWithoutMarketInput = {
    create?: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput> | TradeCreateWithoutMarketInput[] | TradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: TradeCreateOrConnectWithoutMarketInput | TradeCreateOrConnectWithoutMarketInput[]
    createMany?: TradeCreateManyMarketInputEnvelope
    connect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
  }

  export type PositionUncheckedCreateNestedManyWithoutMarketInput = {
    create?: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput> | PositionCreateWithoutMarketInput[] | PositionUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: PositionCreateOrConnectWithoutMarketInput | PositionCreateOrConnectWithoutMarketInput[]
    createMany?: PositionCreateManyMarketInputEnvelope
    connect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
  }

  export type ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput = {
    create?: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput> | ReasoningTraceCreateWithoutMarketInput[] | ReasoningTraceUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutMarketInput | ReasoningTraceCreateOrConnectWithoutMarketInput[]
    createMany?: ReasoningTraceCreateManyMarketInputEnvelope
    connect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
  }

  export type CopyTradeUncheckedCreateNestedManyWithoutMarketInput = {
    create?: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput> | CopyTradeCreateWithoutMarketInput[] | CopyTradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutMarketInput | CopyTradeCreateOrConnectWithoutMarketInput[]
    createMany?: CopyTradeCreateManyMarketInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type AgentLogUncheckedCreateNestedManyWithoutMarketInput = {
    create?: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput> | AgentLogCreateWithoutMarketInput[] | AgentLogUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: AgentLogCreateOrConnectWithoutMarketInput | AgentLogCreateOrConnectWithoutMarketInput[]
    createMany?: AgentLogCreateManyMarketInputEnvelope
    connect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
  }

  export type EnumMarketCategoryFieldUpdateOperationsInput = {
    set?: $Enums.MarketCategory
  }

  export type EnumMarketStatusFieldUpdateOperationsInput = {
    set?: $Enums.MarketStatus
  }

  export type EnumSettlementCurrencyFieldUpdateOperationsInput = {
    set?: $Enums.SettlementCurrency
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type TradeUpdateManyWithoutMarketNestedInput = {
    create?: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput> | TradeCreateWithoutMarketInput[] | TradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: TradeCreateOrConnectWithoutMarketInput | TradeCreateOrConnectWithoutMarketInput[]
    upsert?: TradeUpsertWithWhereUniqueWithoutMarketInput | TradeUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: TradeCreateManyMarketInputEnvelope
    set?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    disconnect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    delete?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    connect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    update?: TradeUpdateWithWhereUniqueWithoutMarketInput | TradeUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: TradeUpdateManyWithWhereWithoutMarketInput | TradeUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: TradeScalarWhereInput | TradeScalarWhereInput[]
  }

  export type PositionUpdateManyWithoutMarketNestedInput = {
    create?: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput> | PositionCreateWithoutMarketInput[] | PositionUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: PositionCreateOrConnectWithoutMarketInput | PositionCreateOrConnectWithoutMarketInput[]
    upsert?: PositionUpsertWithWhereUniqueWithoutMarketInput | PositionUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: PositionCreateManyMarketInputEnvelope
    set?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    disconnect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    delete?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    connect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    update?: PositionUpdateWithWhereUniqueWithoutMarketInput | PositionUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: PositionUpdateManyWithWhereWithoutMarketInput | PositionUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: PositionScalarWhereInput | PositionScalarWhereInput[]
  }

  export type ReasoningTraceUpdateManyWithoutMarketNestedInput = {
    create?: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput> | ReasoningTraceCreateWithoutMarketInput[] | ReasoningTraceUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutMarketInput | ReasoningTraceCreateOrConnectWithoutMarketInput[]
    upsert?: ReasoningTraceUpsertWithWhereUniqueWithoutMarketInput | ReasoningTraceUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: ReasoningTraceCreateManyMarketInputEnvelope
    set?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    disconnect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    delete?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    connect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    update?: ReasoningTraceUpdateWithWhereUniqueWithoutMarketInput | ReasoningTraceUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: ReasoningTraceUpdateManyWithWhereWithoutMarketInput | ReasoningTraceUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: ReasoningTraceScalarWhereInput | ReasoningTraceScalarWhereInput[]
  }

  export type CopyTradeUpdateManyWithoutMarketNestedInput = {
    create?: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput> | CopyTradeCreateWithoutMarketInput[] | CopyTradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutMarketInput | CopyTradeCreateOrConnectWithoutMarketInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutMarketInput | CopyTradeUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: CopyTradeCreateManyMarketInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutMarketInput | CopyTradeUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutMarketInput | CopyTradeUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type AgentLogUpdateManyWithoutMarketNestedInput = {
    create?: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput> | AgentLogCreateWithoutMarketInput[] | AgentLogUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: AgentLogCreateOrConnectWithoutMarketInput | AgentLogCreateOrConnectWithoutMarketInput[]
    upsert?: AgentLogUpsertWithWhereUniqueWithoutMarketInput | AgentLogUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: AgentLogCreateManyMarketInputEnvelope
    set?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    disconnect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    delete?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    connect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    update?: AgentLogUpdateWithWhereUniqueWithoutMarketInput | AgentLogUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: AgentLogUpdateManyWithWhereWithoutMarketInput | AgentLogUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: AgentLogScalarWhereInput | AgentLogScalarWhereInput[]
  }

  export type TradeUncheckedUpdateManyWithoutMarketNestedInput = {
    create?: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput> | TradeCreateWithoutMarketInput[] | TradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: TradeCreateOrConnectWithoutMarketInput | TradeCreateOrConnectWithoutMarketInput[]
    upsert?: TradeUpsertWithWhereUniqueWithoutMarketInput | TradeUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: TradeCreateManyMarketInputEnvelope
    set?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    disconnect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    delete?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    connect?: TradeWhereUniqueInput | TradeWhereUniqueInput[]
    update?: TradeUpdateWithWhereUniqueWithoutMarketInput | TradeUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: TradeUpdateManyWithWhereWithoutMarketInput | TradeUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: TradeScalarWhereInput | TradeScalarWhereInput[]
  }

  export type PositionUncheckedUpdateManyWithoutMarketNestedInput = {
    create?: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput> | PositionCreateWithoutMarketInput[] | PositionUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: PositionCreateOrConnectWithoutMarketInput | PositionCreateOrConnectWithoutMarketInput[]
    upsert?: PositionUpsertWithWhereUniqueWithoutMarketInput | PositionUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: PositionCreateManyMarketInputEnvelope
    set?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    disconnect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    delete?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    connect?: PositionWhereUniqueInput | PositionWhereUniqueInput[]
    update?: PositionUpdateWithWhereUniqueWithoutMarketInput | PositionUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: PositionUpdateManyWithWhereWithoutMarketInput | PositionUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: PositionScalarWhereInput | PositionScalarWhereInput[]
  }

  export type ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput = {
    create?: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput> | ReasoningTraceCreateWithoutMarketInput[] | ReasoningTraceUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutMarketInput | ReasoningTraceCreateOrConnectWithoutMarketInput[]
    upsert?: ReasoningTraceUpsertWithWhereUniqueWithoutMarketInput | ReasoningTraceUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: ReasoningTraceCreateManyMarketInputEnvelope
    set?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    disconnect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    delete?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    connect?: ReasoningTraceWhereUniqueInput | ReasoningTraceWhereUniqueInput[]
    update?: ReasoningTraceUpdateWithWhereUniqueWithoutMarketInput | ReasoningTraceUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: ReasoningTraceUpdateManyWithWhereWithoutMarketInput | ReasoningTraceUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: ReasoningTraceScalarWhereInput | ReasoningTraceScalarWhereInput[]
  }

  export type CopyTradeUncheckedUpdateManyWithoutMarketNestedInput = {
    create?: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput> | CopyTradeCreateWithoutMarketInput[] | CopyTradeUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutMarketInput | CopyTradeCreateOrConnectWithoutMarketInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutMarketInput | CopyTradeUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: CopyTradeCreateManyMarketInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutMarketInput | CopyTradeUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutMarketInput | CopyTradeUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type AgentLogUncheckedUpdateManyWithoutMarketNestedInput = {
    create?: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput> | AgentLogCreateWithoutMarketInput[] | AgentLogUncheckedCreateWithoutMarketInput[]
    connectOrCreate?: AgentLogCreateOrConnectWithoutMarketInput | AgentLogCreateOrConnectWithoutMarketInput[]
    upsert?: AgentLogUpsertWithWhereUniqueWithoutMarketInput | AgentLogUpsertWithWhereUniqueWithoutMarketInput[]
    createMany?: AgentLogCreateManyMarketInputEnvelope
    set?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    disconnect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    delete?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    connect?: AgentLogWhereUniqueInput | AgentLogWhereUniqueInput[]
    update?: AgentLogUpdateWithWhereUniqueWithoutMarketInput | AgentLogUpdateWithWhereUniqueWithoutMarketInput[]
    updateMany?: AgentLogUpdateManyWithWhereWithoutMarketInput | AgentLogUpdateManyWithWhereWithoutMarketInput[]
    deleteMany?: AgentLogScalarWhereInput | AgentLogScalarWhereInput[]
  }

  export type MarketCreateNestedOneWithoutTradesInput = {
    create?: XOR<MarketCreateWithoutTradesInput, MarketUncheckedCreateWithoutTradesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutTradesInput
    connect?: MarketWhereUniqueInput
  }

  export type PositionCreateNestedOneWithoutTradeInput = {
    create?: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
    connectOrCreate?: PositionCreateOrConnectWithoutTradeInput
    connect?: PositionWhereUniqueInput
  }

  export type CopyTradeCreateNestedManyWithoutTradeInput = {
    create?: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput> | CopyTradeCreateWithoutTradeInput[] | CopyTradeUncheckedCreateWithoutTradeInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTradeInput | CopyTradeCreateOrConnectWithoutTradeInput[]
    createMany?: CopyTradeCreateManyTradeInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type PositionUncheckedCreateNestedOneWithoutTradeInput = {
    create?: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
    connectOrCreate?: PositionCreateOrConnectWithoutTradeInput
    connect?: PositionWhereUniqueInput
  }

  export type CopyTradeUncheckedCreateNestedManyWithoutTradeInput = {
    create?: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput> | CopyTradeCreateWithoutTradeInput[] | CopyTradeUncheckedCreateWithoutTradeInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTradeInput | CopyTradeCreateOrConnectWithoutTradeInput[]
    createMany?: CopyTradeCreateManyTradeInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type EnumTradeDirectionFieldUpdateOperationsInput = {
    set?: $Enums.TradeDirection
  }

  export type EnumTradeStatusFieldUpdateOperationsInput = {
    set?: $Enums.TradeStatus
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type MarketUpdateOneRequiredWithoutTradesNestedInput = {
    create?: XOR<MarketCreateWithoutTradesInput, MarketUncheckedCreateWithoutTradesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutTradesInput
    upsert?: MarketUpsertWithoutTradesInput
    connect?: MarketWhereUniqueInput
    update?: XOR<XOR<MarketUpdateToOneWithWhereWithoutTradesInput, MarketUpdateWithoutTradesInput>, MarketUncheckedUpdateWithoutTradesInput>
  }

  export type PositionUpdateOneWithoutTradeNestedInput = {
    create?: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
    connectOrCreate?: PositionCreateOrConnectWithoutTradeInput
    upsert?: PositionUpsertWithoutTradeInput
    disconnect?: PositionWhereInput | boolean
    delete?: PositionWhereInput | boolean
    connect?: PositionWhereUniqueInput
    update?: XOR<XOR<PositionUpdateToOneWithWhereWithoutTradeInput, PositionUpdateWithoutTradeInput>, PositionUncheckedUpdateWithoutTradeInput>
  }

  export type CopyTradeUpdateManyWithoutTradeNestedInput = {
    create?: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput> | CopyTradeCreateWithoutTradeInput[] | CopyTradeUncheckedCreateWithoutTradeInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTradeInput | CopyTradeCreateOrConnectWithoutTradeInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutTradeInput | CopyTradeUpsertWithWhereUniqueWithoutTradeInput[]
    createMany?: CopyTradeCreateManyTradeInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutTradeInput | CopyTradeUpdateWithWhereUniqueWithoutTradeInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutTradeInput | CopyTradeUpdateManyWithWhereWithoutTradeInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type PositionUncheckedUpdateOneWithoutTradeNestedInput = {
    create?: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
    connectOrCreate?: PositionCreateOrConnectWithoutTradeInput
    upsert?: PositionUpsertWithoutTradeInput
    disconnect?: PositionWhereInput | boolean
    delete?: PositionWhereInput | boolean
    connect?: PositionWhereUniqueInput
    update?: XOR<XOR<PositionUpdateToOneWithWhereWithoutTradeInput, PositionUpdateWithoutTradeInput>, PositionUncheckedUpdateWithoutTradeInput>
  }

  export type CopyTradeUncheckedUpdateManyWithoutTradeNestedInput = {
    create?: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput> | CopyTradeCreateWithoutTradeInput[] | CopyTradeUncheckedCreateWithoutTradeInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTradeInput | CopyTradeCreateOrConnectWithoutTradeInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutTradeInput | CopyTradeUpsertWithWhereUniqueWithoutTradeInput[]
    createMany?: CopyTradeCreateManyTradeInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutTradeInput | CopyTradeUpdateWithWhereUniqueWithoutTradeInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutTradeInput | CopyTradeUpdateManyWithWhereWithoutTradeInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type MarketCreateNestedOneWithoutPositionsInput = {
    create?: XOR<MarketCreateWithoutPositionsInput, MarketUncheckedCreateWithoutPositionsInput>
    connectOrCreate?: MarketCreateOrConnectWithoutPositionsInput
    connect?: MarketWhereUniqueInput
  }

  export type TradeCreateNestedOneWithoutPositionInput = {
    create?: XOR<TradeCreateWithoutPositionInput, TradeUncheckedCreateWithoutPositionInput>
    connectOrCreate?: TradeCreateOrConnectWithoutPositionInput
    connect?: TradeWhereUniqueInput
  }

  export type EnumPositionStatusFieldUpdateOperationsInput = {
    set?: $Enums.PositionStatus
  }

  export type MarketUpdateOneRequiredWithoutPositionsNestedInput = {
    create?: XOR<MarketCreateWithoutPositionsInput, MarketUncheckedCreateWithoutPositionsInput>
    connectOrCreate?: MarketCreateOrConnectWithoutPositionsInput
    upsert?: MarketUpsertWithoutPositionsInput
    connect?: MarketWhereUniqueInput
    update?: XOR<XOR<MarketUpdateToOneWithWhereWithoutPositionsInput, MarketUpdateWithoutPositionsInput>, MarketUncheckedUpdateWithoutPositionsInput>
  }

  export type TradeUpdateOneRequiredWithoutPositionNestedInput = {
    create?: XOR<TradeCreateWithoutPositionInput, TradeUncheckedCreateWithoutPositionInput>
    connectOrCreate?: TradeCreateOrConnectWithoutPositionInput
    upsert?: TradeUpsertWithoutPositionInput
    connect?: TradeWhereUniqueInput
    update?: XOR<XOR<TradeUpdateToOneWithWhereWithoutPositionInput, TradeUpdateWithoutPositionInput>, TradeUncheckedUpdateWithoutPositionInput>
  }

  export type MarketCreateNestedOneWithoutReasoningTracesInput = {
    create?: XOR<MarketCreateWithoutReasoningTracesInput, MarketUncheckedCreateWithoutReasoningTracesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutReasoningTracesInput
    connect?: MarketWhereUniqueInput
  }

  export type CopyTradeCreateNestedManyWithoutTraceInput = {
    create?: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput> | CopyTradeCreateWithoutTraceInput[] | CopyTradeUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTraceInput | CopyTradeCreateOrConnectWithoutTraceInput[]
    createMany?: CopyTradeCreateManyTraceInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type SubscriptionCreateNestedManyWithoutTraceInput = {
    create?: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput> | SubscriptionCreateWithoutTraceInput[] | SubscriptionUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTraceInput | SubscriptionCreateOrConnectWithoutTraceInput[]
    createMany?: SubscriptionCreateManyTraceInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type CopyTradeUncheckedCreateNestedManyWithoutTraceInput = {
    create?: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput> | CopyTradeCreateWithoutTraceInput[] | CopyTradeUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTraceInput | CopyTradeCreateOrConnectWithoutTraceInput[]
    createMany?: CopyTradeCreateManyTraceInputEnvelope
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
  }

  export type SubscriptionUncheckedCreateNestedManyWithoutTraceInput = {
    create?: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput> | SubscriptionCreateWithoutTraceInput[] | SubscriptionUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTraceInput | SubscriptionCreateOrConnectWithoutTraceInput[]
    createMany?: SubscriptionCreateManyTraceInputEnvelope
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
  }

  export type EnumAgentTypeFieldUpdateOperationsInput = {
    set?: $Enums.AgentType
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type MarketUpdateOneRequiredWithoutReasoningTracesNestedInput = {
    create?: XOR<MarketCreateWithoutReasoningTracesInput, MarketUncheckedCreateWithoutReasoningTracesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutReasoningTracesInput
    upsert?: MarketUpsertWithoutReasoningTracesInput
    connect?: MarketWhereUniqueInput
    update?: XOR<XOR<MarketUpdateToOneWithWhereWithoutReasoningTracesInput, MarketUpdateWithoutReasoningTracesInput>, MarketUncheckedUpdateWithoutReasoningTracesInput>
  }

  export type CopyTradeUpdateManyWithoutTraceNestedInput = {
    create?: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput> | CopyTradeCreateWithoutTraceInput[] | CopyTradeUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTraceInput | CopyTradeCreateOrConnectWithoutTraceInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutTraceInput | CopyTradeUpsertWithWhereUniqueWithoutTraceInput[]
    createMany?: CopyTradeCreateManyTraceInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutTraceInput | CopyTradeUpdateWithWhereUniqueWithoutTraceInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutTraceInput | CopyTradeUpdateManyWithWhereWithoutTraceInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type SubscriptionUpdateManyWithoutTraceNestedInput = {
    create?: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput> | SubscriptionCreateWithoutTraceInput[] | SubscriptionUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTraceInput | SubscriptionCreateOrConnectWithoutTraceInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutTraceInput | SubscriptionUpsertWithWhereUniqueWithoutTraceInput[]
    createMany?: SubscriptionCreateManyTraceInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutTraceInput | SubscriptionUpdateWithWhereUniqueWithoutTraceInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutTraceInput | SubscriptionUpdateManyWithWhereWithoutTraceInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type CopyTradeUncheckedUpdateManyWithoutTraceNestedInput = {
    create?: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput> | CopyTradeCreateWithoutTraceInput[] | CopyTradeUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: CopyTradeCreateOrConnectWithoutTraceInput | CopyTradeCreateOrConnectWithoutTraceInput[]
    upsert?: CopyTradeUpsertWithWhereUniqueWithoutTraceInput | CopyTradeUpsertWithWhereUniqueWithoutTraceInput[]
    createMany?: CopyTradeCreateManyTraceInputEnvelope
    set?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    disconnect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    delete?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    connect?: CopyTradeWhereUniqueInput | CopyTradeWhereUniqueInput[]
    update?: CopyTradeUpdateWithWhereUniqueWithoutTraceInput | CopyTradeUpdateWithWhereUniqueWithoutTraceInput[]
    updateMany?: CopyTradeUpdateManyWithWhereWithoutTraceInput | CopyTradeUpdateManyWithWhereWithoutTraceInput[]
    deleteMany?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
  }

  export type SubscriptionUncheckedUpdateManyWithoutTraceNestedInput = {
    create?: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput> | SubscriptionCreateWithoutTraceInput[] | SubscriptionUncheckedCreateWithoutTraceInput[]
    connectOrCreate?: SubscriptionCreateOrConnectWithoutTraceInput | SubscriptionCreateOrConnectWithoutTraceInput[]
    upsert?: SubscriptionUpsertWithWhereUniqueWithoutTraceInput | SubscriptionUpsertWithWhereUniqueWithoutTraceInput[]
    createMany?: SubscriptionCreateManyTraceInputEnvelope
    set?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    disconnect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    delete?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    connect?: SubscriptionWhereUniqueInput | SubscriptionWhereUniqueInput[]
    update?: SubscriptionUpdateWithWhereUniqueWithoutTraceInput | SubscriptionUpdateWithWhereUniqueWithoutTraceInput[]
    updateMany?: SubscriptionUpdateManyWithWhereWithoutTraceInput | SubscriptionUpdateManyWithWhereWithoutTraceInput[]
    deleteMany?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
  }

  export type UserCreateNestedOneWithoutCopyTradesInput = {
    create?: XOR<UserCreateWithoutCopyTradesInput, UserUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: UserCreateOrConnectWithoutCopyTradesInput
    connect?: UserWhereUniqueInput
  }

  export type ReasoningTraceCreateNestedOneWithoutCopyTradesInput = {
    create?: XOR<ReasoningTraceCreateWithoutCopyTradesInput, ReasoningTraceUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutCopyTradesInput
    connect?: ReasoningTraceWhereUniqueInput
  }

  export type MarketCreateNestedOneWithoutCopyTradesInput = {
    create?: XOR<MarketCreateWithoutCopyTradesInput, MarketUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutCopyTradesInput
    connect?: MarketWhereUniqueInput
  }

  export type TradeCreateNestedOneWithoutCopyTradesInput = {
    create?: XOR<TradeCreateWithoutCopyTradesInput, TradeUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: TradeCreateOrConnectWithoutCopyTradesInput
    connect?: TradeWhereUniqueInput
  }

  export type UserUpdateOneRequiredWithoutCopyTradesNestedInput = {
    create?: XOR<UserCreateWithoutCopyTradesInput, UserUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: UserCreateOrConnectWithoutCopyTradesInput
    upsert?: UserUpsertWithoutCopyTradesInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutCopyTradesInput, UserUpdateWithoutCopyTradesInput>, UserUncheckedUpdateWithoutCopyTradesInput>
  }

  export type ReasoningTraceUpdateOneRequiredWithoutCopyTradesNestedInput = {
    create?: XOR<ReasoningTraceCreateWithoutCopyTradesInput, ReasoningTraceUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutCopyTradesInput
    upsert?: ReasoningTraceUpsertWithoutCopyTradesInput
    connect?: ReasoningTraceWhereUniqueInput
    update?: XOR<XOR<ReasoningTraceUpdateToOneWithWhereWithoutCopyTradesInput, ReasoningTraceUpdateWithoutCopyTradesInput>, ReasoningTraceUncheckedUpdateWithoutCopyTradesInput>
  }

  export type MarketUpdateOneRequiredWithoutCopyTradesNestedInput = {
    create?: XOR<MarketCreateWithoutCopyTradesInput, MarketUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: MarketCreateOrConnectWithoutCopyTradesInput
    upsert?: MarketUpsertWithoutCopyTradesInput
    connect?: MarketWhereUniqueInput
    update?: XOR<XOR<MarketUpdateToOneWithWhereWithoutCopyTradesInput, MarketUpdateWithoutCopyTradesInput>, MarketUncheckedUpdateWithoutCopyTradesInput>
  }

  export type TradeUpdateOneWithoutCopyTradesNestedInput = {
    create?: XOR<TradeCreateWithoutCopyTradesInput, TradeUncheckedCreateWithoutCopyTradesInput>
    connectOrCreate?: TradeCreateOrConnectWithoutCopyTradesInput
    upsert?: TradeUpsertWithoutCopyTradesInput
    disconnect?: TradeWhereInput | boolean
    delete?: TradeWhereInput | boolean
    connect?: TradeWhereUniqueInput
    update?: XOR<XOR<TradeUpdateToOneWithWhereWithoutCopyTradesInput, TradeUpdateWithoutCopyTradesInput>, TradeUncheckedUpdateWithoutCopyTradesInput>
  }

  export type UserCreateNestedOneWithoutSubscriptionsInput = {
    create?: XOR<UserCreateWithoutSubscriptionsInput, UserUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutSubscriptionsInput
    connect?: UserWhereUniqueInput
  }

  export type ReasoningTraceCreateNestedOneWithoutSubscriptionsInput = {
    create?: XOR<ReasoningTraceCreateWithoutSubscriptionsInput, ReasoningTraceUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutSubscriptionsInput
    connect?: ReasoningTraceWhereUniqueInput
  }

  export type EnumSubscriptionTypeFieldUpdateOperationsInput = {
    set?: $Enums.SubscriptionType
  }

  export type EnumSubscriptionStatusFieldUpdateOperationsInput = {
    set?: $Enums.SubscriptionStatus
  }

  export type UserUpdateOneRequiredWithoutSubscriptionsNestedInput = {
    create?: XOR<UserCreateWithoutSubscriptionsInput, UserUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: UserCreateOrConnectWithoutSubscriptionsInput
    upsert?: UserUpsertWithoutSubscriptionsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutSubscriptionsInput, UserUpdateWithoutSubscriptionsInput>, UserUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type ReasoningTraceUpdateOneWithoutSubscriptionsNestedInput = {
    create?: XOR<ReasoningTraceCreateWithoutSubscriptionsInput, ReasoningTraceUncheckedCreateWithoutSubscriptionsInput>
    connectOrCreate?: ReasoningTraceCreateOrConnectWithoutSubscriptionsInput
    upsert?: ReasoningTraceUpsertWithoutSubscriptionsInput
    disconnect?: ReasoningTraceWhereInput | boolean
    delete?: ReasoningTraceWhereInput | boolean
    connect?: ReasoningTraceWhereUniqueInput
    update?: XOR<XOR<ReasoningTraceUpdateToOneWithWhereWithoutSubscriptionsInput, ReasoningTraceUpdateWithoutSubscriptionsInput>, ReasoningTraceUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type MarketCreateNestedOneWithoutAgentLogsInput = {
    create?: XOR<MarketCreateWithoutAgentLogsInput, MarketUncheckedCreateWithoutAgentLogsInput>
    connectOrCreate?: MarketCreateOrConnectWithoutAgentLogsInput
    connect?: MarketWhereUniqueInput
  }

  export type EnumLogLevelFieldUpdateOperationsInput = {
    set?: $Enums.LogLevel
  }

  export type MarketUpdateOneWithoutAgentLogsNestedInput = {
    create?: XOR<MarketCreateWithoutAgentLogsInput, MarketUncheckedCreateWithoutAgentLogsInput>
    connectOrCreate?: MarketCreateOrConnectWithoutAgentLogsInput
    upsert?: MarketUpsertWithoutAgentLogsInput
    disconnect?: MarketWhereInput | boolean
    delete?: MarketWhereInput | boolean
    connect?: MarketWhereUniqueInput
    update?: XOR<XOR<MarketUpdateToOneWithWhereWithoutAgentLogsInput, MarketUpdateWithoutAgentLogsInput>, MarketUncheckedUpdateWithoutAgentLogsInput>
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BigIntFieldUpdateOperationsInput = {
    set?: bigint | number
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedEnumMarketCategoryFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketCategory | EnumMarketCategoryFieldRefInput<$PrismaModel>
    in?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketCategoryFilter<$PrismaModel> | $Enums.MarketCategory
  }

  export type NestedEnumMarketStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketStatus | EnumMarketStatusFieldRefInput<$PrismaModel>
    in?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketStatusFilter<$PrismaModel> | $Enums.MarketStatus
  }

  export type NestedEnumSettlementCurrencyFilter<$PrismaModel = never> = {
    equals?: $Enums.SettlementCurrency | EnumSettlementCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumSettlementCurrencyFilter<$PrismaModel> | $Enums.SettlementCurrency
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumMarketCategoryWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketCategory | EnumMarketCategoryFieldRefInput<$PrismaModel>
    in?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketCategory[] | ListEnumMarketCategoryFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketCategoryWithAggregatesFilter<$PrismaModel> | $Enums.MarketCategory
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMarketCategoryFilter<$PrismaModel>
    _max?: NestedEnumMarketCategoryFilter<$PrismaModel>
  }

  export type NestedEnumMarketStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.MarketStatus | EnumMarketStatusFieldRefInput<$PrismaModel>
    in?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.MarketStatus[] | ListEnumMarketStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumMarketStatusWithAggregatesFilter<$PrismaModel> | $Enums.MarketStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumMarketStatusFilter<$PrismaModel>
    _max?: NestedEnumMarketStatusFilter<$PrismaModel>
  }

  export type NestedEnumSettlementCurrencyWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SettlementCurrency | EnumSettlementCurrencyFieldRefInput<$PrismaModel>
    in?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    notIn?: $Enums.SettlementCurrency[] | ListEnumSettlementCurrencyFieldRefInput<$PrismaModel>
    not?: NestedEnumSettlementCurrencyWithAggregatesFilter<$PrismaModel> | $Enums.SettlementCurrency
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSettlementCurrencyFilter<$PrismaModel>
    _max?: NestedEnumSettlementCurrencyFilter<$PrismaModel>
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel> | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }
  export type NestedJsonFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedEnumTradeDirectionFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeDirection | EnumTradeDirectionFieldRefInput<$PrismaModel>
    in?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeDirectionFilter<$PrismaModel> | $Enums.TradeDirection
  }

  export type NestedEnumTradeStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeStatus | EnumTradeStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeStatusFilter<$PrismaModel> | $Enums.TradeStatus
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedEnumTradeDirectionWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeDirection | EnumTradeDirectionFieldRefInput<$PrismaModel>
    in?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeDirection[] | ListEnumTradeDirectionFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeDirectionWithAggregatesFilter<$PrismaModel> | $Enums.TradeDirection
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTradeDirectionFilter<$PrismaModel>
    _max?: NestedEnumTradeDirectionFilter<$PrismaModel>
  }

  export type NestedEnumTradeStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.TradeStatus | EnumTradeStatusFieldRefInput<$PrismaModel>
    in?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.TradeStatus[] | ListEnumTradeStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumTradeStatusWithAggregatesFilter<$PrismaModel> | $Enums.TradeStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumTradeStatusFilter<$PrismaModel>
    _max?: NestedEnumTradeStatusFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedEnumPositionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.PositionStatus | EnumPositionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPositionStatusFilter<$PrismaModel> | $Enums.PositionStatus
  }

  export type NestedEnumPositionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.PositionStatus | EnumPositionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.PositionStatus[] | ListEnumPositionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumPositionStatusWithAggregatesFilter<$PrismaModel> | $Enums.PositionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumPositionStatusFilter<$PrismaModel>
    _max?: NestedEnumPositionStatusFilter<$PrismaModel>
  }

  export type NestedEnumAgentTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.AgentType | EnumAgentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAgentTypeFilter<$PrismaModel> | $Enums.AgentType
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedEnumAgentTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.AgentType | EnumAgentTypeFieldRefInput<$PrismaModel>
    in?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.AgentType[] | ListEnumAgentTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumAgentTypeWithAggregatesFilter<$PrismaModel> | $Enums.AgentType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumAgentTypeFilter<$PrismaModel>
    _max?: NestedEnumAgentTypeFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> =
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    mode?: QueryMode | EnumQueryModeFieldRefInput<$PrismaModel>
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedEnumSubscriptionTypeFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionType | EnumSubscriptionTypeFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionTypeFilter<$PrismaModel> | $Enums.SubscriptionType
  }

  export type NestedEnumSubscriptionStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusFilter<$PrismaModel> | $Enums.SubscriptionStatus
  }

  export type NestedEnumSubscriptionTypeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionType | EnumSubscriptionTypeFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionType[] | ListEnumSubscriptionTypeFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionTypeWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionType
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionTypeFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionTypeFilter<$PrismaModel>
  }

  export type NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.SubscriptionStatus | EnumSubscriptionStatusFieldRefInput<$PrismaModel>
    in?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.SubscriptionStatus[] | ListEnumSubscriptionStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumSubscriptionStatusWithAggregatesFilter<$PrismaModel> | $Enums.SubscriptionStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
    _max?: NestedEnumSubscriptionStatusFilter<$PrismaModel>
  }

  export type NestedEnumLogLevelFilter<$PrismaModel = never> = {
    equals?: $Enums.LogLevel | EnumLogLevelFieldRefInput<$PrismaModel>
    in?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    notIn?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    not?: NestedEnumLogLevelFilter<$PrismaModel> | $Enums.LogLevel
  }

  export type NestedEnumLogLevelWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LogLevel | EnumLogLevelFieldRefInput<$PrismaModel>
    in?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    notIn?: $Enums.LogLevel[] | ListEnumLogLevelFieldRefInput<$PrismaModel>
    not?: NestedEnumLogLevelWithAggregatesFilter<$PrismaModel> | $Enums.LogLevel
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLogLevelFilter<$PrismaModel>
    _max?: NestedEnumLogLevelFilter<$PrismaModel>
  }

  export type NestedBigIntFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntFilter<$PrismaModel> | bigint | number
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedBigIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    in?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    notIn?: bigint[] | number[] | ListBigIntFieldRefInput<$PrismaModel>
    lt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    lte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gt?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    gte?: bigint | number | BigIntFieldRefInput<$PrismaModel>
    not?: NestedBigIntWithAggregatesFilter<$PrismaModel> | bigint | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedBigIntFilter<$PrismaModel>
    _min?: NestedBigIntFilter<$PrismaModel>
    _max?: NestedBigIntFilter<$PrismaModel>
  }

  export type SubscriptionCreateWithoutUserInput = {
    id?: string
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trace?: ReasoningTraceCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateWithoutUserInput = {
    id?: string
    traceId?: string | null
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionCreateOrConnectWithoutUserInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput>
  }

  export type SubscriptionCreateManyUserInputEnvelope = {
    data: SubscriptionCreateManyUserInput | SubscriptionCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type CopyTradeCreateWithoutUserInput = {
    id?: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trace: ReasoningTraceCreateNestedOneWithoutCopyTradesInput
    market: MarketCreateNestedOneWithoutCopyTradesInput
    trade?: TradeCreateNestedOneWithoutCopyTradesInput
  }

  export type CopyTradeUncheckedCreateWithoutUserInput = {
    id?: string
    traceId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateOrConnectWithoutUserInput = {
    where: CopyTradeWhereUniqueInput
    create: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput>
  }

  export type CopyTradeCreateManyUserInputEnvelope = {
    data: CopyTradeCreateManyUserInput | CopyTradeCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutUserInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutUserInput, SubscriptionUncheckedUpdateWithoutUserInput>
    create: XOR<SubscriptionCreateWithoutUserInput, SubscriptionUncheckedCreateWithoutUserInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutUserInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutUserInput, SubscriptionUncheckedUpdateWithoutUserInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutUserInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutUserInput>
  }

  export type SubscriptionScalarWhereInput = {
    AND?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
    OR?: SubscriptionScalarWhereInput[]
    NOT?: SubscriptionScalarWhereInput | SubscriptionScalarWhereInput[]
    id?: StringFilter<"Subscription"> | string
    userId?: StringFilter<"Subscription"> | string
    traceId?: StringNullableFilter<"Subscription"> | string | null
    type?: EnumSubscriptionTypeFilter<"Subscription"> | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFilter<"Subscription"> | $Enums.SubscriptionStatus
    amountPaid?: FloatFilter<"Subscription"> | number
    currency?: StringFilter<"Subscription"> | string
    txHash?: StringNullableFilter<"Subscription"> | string | null
    expiresAt?: DateTimeNullableFilter<"Subscription"> | Date | string | null
    createdAt?: DateTimeFilter<"Subscription"> | Date | string
    updatedAt?: DateTimeFilter<"Subscription"> | Date | string
  }

  export type CopyTradeUpsertWithWhereUniqueWithoutUserInput = {
    where: CopyTradeWhereUniqueInput
    update: XOR<CopyTradeUpdateWithoutUserInput, CopyTradeUncheckedUpdateWithoutUserInput>
    create: XOR<CopyTradeCreateWithoutUserInput, CopyTradeUncheckedCreateWithoutUserInput>
  }

  export type CopyTradeUpdateWithWhereUniqueWithoutUserInput = {
    where: CopyTradeWhereUniqueInput
    data: XOR<CopyTradeUpdateWithoutUserInput, CopyTradeUncheckedUpdateWithoutUserInput>
  }

  export type CopyTradeUpdateManyWithWhereWithoutUserInput = {
    where: CopyTradeScalarWhereInput
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyWithoutUserInput>
  }

  export type CopyTradeScalarWhereInput = {
    AND?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
    OR?: CopyTradeScalarWhereInput[]
    NOT?: CopyTradeScalarWhereInput | CopyTradeScalarWhereInput[]
    id?: StringFilter<"CopyTrade"> | string
    userId?: StringFilter<"CopyTrade"> | string
    traceId?: StringFilter<"CopyTrade"> | string
    marketId?: StringFilter<"CopyTrade"> | string
    tradeId?: StringNullableFilter<"CopyTrade"> | string | null
    direction?: EnumTradeDirectionFilter<"CopyTrade"> | $Enums.TradeDirection
    amount?: FloatFilter<"CopyTrade"> | number
    txHash?: StringNullableFilter<"CopyTrade"> | string | null
    builderFee?: FloatFilter<"CopyTrade"> | number
    status?: EnumTradeStatusFilter<"CopyTrade"> | $Enums.TradeStatus
    pnl?: FloatNullableFilter<"CopyTrade"> | number | null
    createdAt?: DateTimeFilter<"CopyTrade"> | Date | string
    updatedAt?: DateTimeFilter<"CopyTrade"> | Date | string
  }

  export type TradeCreateWithoutMarketInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    position?: PositionCreateNestedOneWithoutTradeInput
    copyTrades?: CopyTradeCreateNestedManyWithoutTradeInput
  }

  export type TradeUncheckedCreateWithoutMarketInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    position?: PositionUncheckedCreateNestedOneWithoutTradeInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTradeInput
  }

  export type TradeCreateOrConnectWithoutMarketInput = {
    where: TradeWhereUniqueInput
    create: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput>
  }

  export type TradeCreateManyMarketInputEnvelope = {
    data: TradeCreateManyMarketInput | TradeCreateManyMarketInput[]
    skipDuplicates?: boolean
  }

  export type PositionCreateWithoutMarketInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trade: TradeCreateNestedOneWithoutPositionInput
  }

  export type PositionUncheckedCreateWithoutMarketInput = {
    id?: string
    tradeId: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PositionCreateOrConnectWithoutMarketInput = {
    where: PositionWhereUniqueInput
    create: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput>
  }

  export type PositionCreateManyMarketInputEnvelope = {
    data: PositionCreateManyMarketInput | PositionCreateManyMarketInput[]
    skipDuplicates?: boolean
  }

  export type ReasoningTraceCreateWithoutMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeCreateNestedManyWithoutTraceInput
    subscriptions?: SubscriptionCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceUncheckedCreateWithoutMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTraceInput
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceCreateOrConnectWithoutMarketInput = {
    where: ReasoningTraceWhereUniqueInput
    create: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput>
  }

  export type ReasoningTraceCreateManyMarketInputEnvelope = {
    data: ReasoningTraceCreateManyMarketInput | ReasoningTraceCreateManyMarketInput[]
    skipDuplicates?: boolean
  }

  export type CopyTradeCreateWithoutMarketInput = {
    id?: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutCopyTradesInput
    trace: ReasoningTraceCreateNestedOneWithoutCopyTradesInput
    trade?: TradeCreateNestedOneWithoutCopyTradesInput
  }

  export type CopyTradeUncheckedCreateWithoutMarketInput = {
    id?: string
    userId: string
    traceId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateOrConnectWithoutMarketInput = {
    where: CopyTradeWhereUniqueInput
    create: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput>
  }

  export type CopyTradeCreateManyMarketInputEnvelope = {
    data: CopyTradeCreateManyMarketInput | CopyTradeCreateManyMarketInput[]
    skipDuplicates?: boolean
  }

  export type AgentLogCreateWithoutMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
  }

  export type AgentLogUncheckedCreateWithoutMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
  }

  export type AgentLogCreateOrConnectWithoutMarketInput = {
    where: AgentLogWhereUniqueInput
    create: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput>
  }

  export type AgentLogCreateManyMarketInputEnvelope = {
    data: AgentLogCreateManyMarketInput | AgentLogCreateManyMarketInput[]
    skipDuplicates?: boolean
  }

  export type TradeUpsertWithWhereUniqueWithoutMarketInput = {
    where: TradeWhereUniqueInput
    update: XOR<TradeUpdateWithoutMarketInput, TradeUncheckedUpdateWithoutMarketInput>
    create: XOR<TradeCreateWithoutMarketInput, TradeUncheckedCreateWithoutMarketInput>
  }

  export type TradeUpdateWithWhereUniqueWithoutMarketInput = {
    where: TradeWhereUniqueInput
    data: XOR<TradeUpdateWithoutMarketInput, TradeUncheckedUpdateWithoutMarketInput>
  }

  export type TradeUpdateManyWithWhereWithoutMarketInput = {
    where: TradeScalarWhereInput
    data: XOR<TradeUpdateManyMutationInput, TradeUncheckedUpdateManyWithoutMarketInput>
  }

  export type TradeScalarWhereInput = {
    AND?: TradeScalarWhereInput | TradeScalarWhereInput[]
    OR?: TradeScalarWhereInput[]
    NOT?: TradeScalarWhereInput | TradeScalarWhereInput[]
    id?: StringFilter<"Trade"> | string
    marketId?: StringFilter<"Trade"> | string
    direction?: EnumTradeDirectionFilter<"Trade"> | $Enums.TradeDirection
    status?: EnumTradeStatusFilter<"Trade"> | $Enums.TradeStatus
    amount?: FloatFilter<"Trade"> | number
    price?: FloatFilter<"Trade"> | number
    edgeDetected?: FloatFilter<"Trade"> | number
    kellyFraction?: FloatFilter<"Trade"> | number
    txHash?: StringNullableFilter<"Trade"> | string | null
    builderFee?: FloatFilter<"Trade"> | number
    errorMessage?: StringNullableFilter<"Trade"> | string | null
    executedAt?: DateTimeNullableFilter<"Trade"> | Date | string | null
    createdAt?: DateTimeFilter<"Trade"> | Date | string
    updatedAt?: DateTimeFilter<"Trade"> | Date | string
  }

  export type PositionUpsertWithWhereUniqueWithoutMarketInput = {
    where: PositionWhereUniqueInput
    update: XOR<PositionUpdateWithoutMarketInput, PositionUncheckedUpdateWithoutMarketInput>
    create: XOR<PositionCreateWithoutMarketInput, PositionUncheckedCreateWithoutMarketInput>
  }

  export type PositionUpdateWithWhereUniqueWithoutMarketInput = {
    where: PositionWhereUniqueInput
    data: XOR<PositionUpdateWithoutMarketInput, PositionUncheckedUpdateWithoutMarketInput>
  }

  export type PositionUpdateManyWithWhereWithoutMarketInput = {
    where: PositionScalarWhereInput
    data: XOR<PositionUpdateManyMutationInput, PositionUncheckedUpdateManyWithoutMarketInput>
  }

  export type PositionScalarWhereInput = {
    AND?: PositionScalarWhereInput | PositionScalarWhereInput[]
    OR?: PositionScalarWhereInput[]
    NOT?: PositionScalarWhereInput | PositionScalarWhereInput[]
    id?: StringFilter<"Position"> | string
    marketId?: StringFilter<"Position"> | string
    tradeId?: StringFilter<"Position"> | string
    direction?: EnumTradeDirectionFilter<"Position"> | $Enums.TradeDirection
    status?: EnumPositionStatusFilter<"Position"> | $Enums.PositionStatus
    entryPrice?: FloatFilter<"Position"> | number
    currentPrice?: FloatNullableFilter<"Position"> | number | null
    size?: FloatFilter<"Position"> | number
    pnl?: FloatFilter<"Position"> | number
    hedgeMarketId?: StringNullableFilter<"Position"> | string | null
    closedAt?: DateTimeNullableFilter<"Position"> | Date | string | null
    closeReason?: StringNullableFilter<"Position"> | string | null
    createdAt?: DateTimeFilter<"Position"> | Date | string
    updatedAt?: DateTimeFilter<"Position"> | Date | string
  }

  export type ReasoningTraceUpsertWithWhereUniqueWithoutMarketInput = {
    where: ReasoningTraceWhereUniqueInput
    update: XOR<ReasoningTraceUpdateWithoutMarketInput, ReasoningTraceUncheckedUpdateWithoutMarketInput>
    create: XOR<ReasoningTraceCreateWithoutMarketInput, ReasoningTraceUncheckedCreateWithoutMarketInput>
  }

  export type ReasoningTraceUpdateWithWhereUniqueWithoutMarketInput = {
    where: ReasoningTraceWhereUniqueInput
    data: XOR<ReasoningTraceUpdateWithoutMarketInput, ReasoningTraceUncheckedUpdateWithoutMarketInput>
  }

  export type ReasoningTraceUpdateManyWithWhereWithoutMarketInput = {
    where: ReasoningTraceScalarWhereInput
    data: XOR<ReasoningTraceUpdateManyMutationInput, ReasoningTraceUncheckedUpdateManyWithoutMarketInput>
  }

  export type ReasoningTraceScalarWhereInput = {
    AND?: ReasoningTraceScalarWhereInput | ReasoningTraceScalarWhereInput[]
    OR?: ReasoningTraceScalarWhereInput[]
    NOT?: ReasoningTraceScalarWhereInput | ReasoningTraceScalarWhereInput[]
    id?: StringFilter<"ReasoningTrace"> | string
    marketId?: StringFilter<"ReasoningTrace"> | string
    agentType?: EnumAgentTypeFilter<"ReasoningTrace"> | $Enums.AgentType
    decisionType?: StringFilter<"ReasoningTrace"> | string
    sourcesUsed?: JsonFilter<"ReasoningTrace">
    probabilityEstimate?: FloatFilter<"ReasoningTrace"> | number
    marketProbability?: FloatFilter<"ReasoningTrace"> | number
    edge?: FloatFilter<"ReasoningTrace"> | number
    confidenceInterval?: JsonFilter<"ReasoningTrace">
    betFraction?: FloatNullableFilter<"ReasoningTrace"> | number | null
    betSizeUsdc?: FloatNullableFilter<"ReasoningTrace"> | number | null
    hedgeConditions?: JsonNullableFilter<"ReasoningTrace">
    agentWallet?: StringNullableFilter<"ReasoningTrace"> | string | null
    signature?: StringNullableFilter<"ReasoningTrace"> | string | null
    ipfsCid?: StringNullableFilter<"ReasoningTrace"> | string | null
    sha256Hash?: StringNullableFilter<"ReasoningTrace"> | string | null
    onChainTxHash?: StringNullableFilter<"ReasoningTrace"> | string | null
    verified?: BoolFilter<"ReasoningTrace"> | boolean
    isPublic?: BoolFilter<"ReasoningTrace"> | boolean
    previewSources?: JsonNullableFilter<"ReasoningTrace">
    createdAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
    updatedAt?: DateTimeFilter<"ReasoningTrace"> | Date | string
  }

  export type CopyTradeUpsertWithWhereUniqueWithoutMarketInput = {
    where: CopyTradeWhereUniqueInput
    update: XOR<CopyTradeUpdateWithoutMarketInput, CopyTradeUncheckedUpdateWithoutMarketInput>
    create: XOR<CopyTradeCreateWithoutMarketInput, CopyTradeUncheckedCreateWithoutMarketInput>
  }

  export type CopyTradeUpdateWithWhereUniqueWithoutMarketInput = {
    where: CopyTradeWhereUniqueInput
    data: XOR<CopyTradeUpdateWithoutMarketInput, CopyTradeUncheckedUpdateWithoutMarketInput>
  }

  export type CopyTradeUpdateManyWithWhereWithoutMarketInput = {
    where: CopyTradeScalarWhereInput
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyWithoutMarketInput>
  }

  export type AgentLogUpsertWithWhereUniqueWithoutMarketInput = {
    where: AgentLogWhereUniqueInput
    update: XOR<AgentLogUpdateWithoutMarketInput, AgentLogUncheckedUpdateWithoutMarketInput>
    create: XOR<AgentLogCreateWithoutMarketInput, AgentLogUncheckedCreateWithoutMarketInput>
  }

  export type AgentLogUpdateWithWhereUniqueWithoutMarketInput = {
    where: AgentLogWhereUniqueInput
    data: XOR<AgentLogUpdateWithoutMarketInput, AgentLogUncheckedUpdateWithoutMarketInput>
  }

  export type AgentLogUpdateManyWithWhereWithoutMarketInput = {
    where: AgentLogScalarWhereInput
    data: XOR<AgentLogUpdateManyMutationInput, AgentLogUncheckedUpdateManyWithoutMarketInput>
  }

  export type AgentLogScalarWhereInput = {
    AND?: AgentLogScalarWhereInput | AgentLogScalarWhereInput[]
    OR?: AgentLogScalarWhereInput[]
    NOT?: AgentLogScalarWhereInput | AgentLogScalarWhereInput[]
    id?: StringFilter<"AgentLog"> | string
    agentType?: EnumAgentTypeFilter<"AgentLog"> | $Enums.AgentType
    level?: EnumLogLevelFilter<"AgentLog"> | $Enums.LogLevel
    action?: StringFilter<"AgentLog"> | string
    marketId?: StringNullableFilter<"AgentLog"> | string | null
    data?: JsonNullableFilter<"AgentLog">
    error?: StringNullableFilter<"AgentLog"> | string | null
    createdAt?: DateTimeFilter<"AgentLog"> | Date | string
  }

  export type MarketCreateWithoutTradesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    positions?: PositionCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateWithoutTradesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    positions?: PositionUncheckedCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketCreateOrConnectWithoutTradesInput = {
    where: MarketWhereUniqueInput
    create: XOR<MarketCreateWithoutTradesInput, MarketUncheckedCreateWithoutTradesInput>
  }

  export type PositionCreateWithoutTradeInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutPositionsInput
  }

  export type PositionUncheckedCreateWithoutTradeInput = {
    id?: string
    marketId: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PositionCreateOrConnectWithoutTradeInput = {
    where: PositionWhereUniqueInput
    create: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
  }

  export type CopyTradeCreateWithoutTradeInput = {
    id?: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutCopyTradesInput
    trace: ReasoningTraceCreateNestedOneWithoutCopyTradesInput
    market: MarketCreateNestedOneWithoutCopyTradesInput
  }

  export type CopyTradeUncheckedCreateWithoutTradeInput = {
    id?: string
    userId: string
    traceId: string
    marketId: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateOrConnectWithoutTradeInput = {
    where: CopyTradeWhereUniqueInput
    create: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput>
  }

  export type CopyTradeCreateManyTradeInputEnvelope = {
    data: CopyTradeCreateManyTradeInput | CopyTradeCreateManyTradeInput[]
    skipDuplicates?: boolean
  }

  export type MarketUpsertWithoutTradesInput = {
    update: XOR<MarketUpdateWithoutTradesInput, MarketUncheckedUpdateWithoutTradesInput>
    create: XOR<MarketCreateWithoutTradesInput, MarketUncheckedCreateWithoutTradesInput>
    where?: MarketWhereInput
  }

  export type MarketUpdateToOneWithWhereWithoutTradesInput = {
    where?: MarketWhereInput
    data: XOR<MarketUpdateWithoutTradesInput, MarketUncheckedUpdateWithoutTradesInput>
  }

  export type MarketUpdateWithoutTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    positions?: PositionUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateWithoutTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    positions?: PositionUncheckedUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type PositionUpsertWithoutTradeInput = {
    update: XOR<PositionUpdateWithoutTradeInput, PositionUncheckedUpdateWithoutTradeInput>
    create: XOR<PositionCreateWithoutTradeInput, PositionUncheckedCreateWithoutTradeInput>
    where?: PositionWhereInput
  }

  export type PositionUpdateToOneWithWhereWithoutTradeInput = {
    where?: PositionWhereInput
    data: XOR<PositionUpdateWithoutTradeInput, PositionUncheckedUpdateWithoutTradeInput>
  }

  export type PositionUpdateWithoutTradeInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutPositionsNestedInput
  }

  export type PositionUncheckedUpdateWithoutTradeInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUpsertWithWhereUniqueWithoutTradeInput = {
    where: CopyTradeWhereUniqueInput
    update: XOR<CopyTradeUpdateWithoutTradeInput, CopyTradeUncheckedUpdateWithoutTradeInput>
    create: XOR<CopyTradeCreateWithoutTradeInput, CopyTradeUncheckedCreateWithoutTradeInput>
  }

  export type CopyTradeUpdateWithWhereUniqueWithoutTradeInput = {
    where: CopyTradeWhereUniqueInput
    data: XOR<CopyTradeUpdateWithoutTradeInput, CopyTradeUncheckedUpdateWithoutTradeInput>
  }

  export type CopyTradeUpdateManyWithWhereWithoutTradeInput = {
    where: CopyTradeScalarWhereInput
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyWithoutTradeInput>
  }

  export type MarketCreateWithoutPositionsInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateWithoutPositionsInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeUncheckedCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketCreateOrConnectWithoutPositionsInput = {
    where: MarketWhereUniqueInput
    create: XOR<MarketCreateWithoutPositionsInput, MarketUncheckedCreateWithoutPositionsInput>
  }

  export type TradeCreateWithoutPositionInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutTradesInput
    copyTrades?: CopyTradeCreateNestedManyWithoutTradeInput
  }

  export type TradeUncheckedCreateWithoutPositionInput = {
    id?: string
    marketId: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTradeInput
  }

  export type TradeCreateOrConnectWithoutPositionInput = {
    where: TradeWhereUniqueInput
    create: XOR<TradeCreateWithoutPositionInput, TradeUncheckedCreateWithoutPositionInput>
  }

  export type MarketUpsertWithoutPositionsInput = {
    update: XOR<MarketUpdateWithoutPositionsInput, MarketUncheckedUpdateWithoutPositionsInput>
    create: XOR<MarketCreateWithoutPositionsInput, MarketUncheckedCreateWithoutPositionsInput>
    where?: MarketWhereInput
  }

  export type MarketUpdateToOneWithWhereWithoutPositionsInput = {
    where?: MarketWhereInput
    data: XOR<MarketUpdateWithoutPositionsInput, MarketUncheckedUpdateWithoutPositionsInput>
  }

  export type MarketUpdateWithoutPositionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateWithoutPositionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUncheckedUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type TradeUpsertWithoutPositionInput = {
    update: XOR<TradeUpdateWithoutPositionInput, TradeUncheckedUpdateWithoutPositionInput>
    create: XOR<TradeCreateWithoutPositionInput, TradeUncheckedCreateWithoutPositionInput>
    where?: TradeWhereInput
  }

  export type TradeUpdateToOneWithWhereWithoutPositionInput = {
    where?: TradeWhereInput
    data: XOR<TradeUpdateWithoutPositionInput, TradeUncheckedUpdateWithoutPositionInput>
  }

  export type TradeUpdateWithoutPositionInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutTradesNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutTradeNestedInput
  }

  export type TradeUncheckedUpdateWithoutPositionInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTradeNestedInput
  }

  export type MarketCreateWithoutReasoningTracesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeCreateNestedManyWithoutMarketInput
    positions?: PositionCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateWithoutReasoningTracesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeUncheckedCreateNestedManyWithoutMarketInput
    positions?: PositionUncheckedCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketCreateOrConnectWithoutReasoningTracesInput = {
    where: MarketWhereUniqueInput
    create: XOR<MarketCreateWithoutReasoningTracesInput, MarketUncheckedCreateWithoutReasoningTracesInput>
  }

  export type CopyTradeCreateWithoutTraceInput = {
    id?: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutCopyTradesInput
    market: MarketCreateNestedOneWithoutCopyTradesInput
    trade?: TradeCreateNestedOneWithoutCopyTradesInput
  }

  export type CopyTradeUncheckedCreateWithoutTraceInput = {
    id?: string
    userId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateOrConnectWithoutTraceInput = {
    where: CopyTradeWhereUniqueInput
    create: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput>
  }

  export type CopyTradeCreateManyTraceInputEnvelope = {
    data: CopyTradeCreateManyTraceInput | CopyTradeCreateManyTraceInput[]
    skipDuplicates?: boolean
  }

  export type SubscriptionCreateWithoutTraceInput = {
    id?: string
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutSubscriptionsInput
  }

  export type SubscriptionUncheckedCreateWithoutTraceInput = {
    id?: string
    userId: string
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionCreateOrConnectWithoutTraceInput = {
    where: SubscriptionWhereUniqueInput
    create: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput>
  }

  export type SubscriptionCreateManyTraceInputEnvelope = {
    data: SubscriptionCreateManyTraceInput | SubscriptionCreateManyTraceInput[]
    skipDuplicates?: boolean
  }

  export type MarketUpsertWithoutReasoningTracesInput = {
    update: XOR<MarketUpdateWithoutReasoningTracesInput, MarketUncheckedUpdateWithoutReasoningTracesInput>
    create: XOR<MarketCreateWithoutReasoningTracesInput, MarketUncheckedCreateWithoutReasoningTracesInput>
    where?: MarketWhereInput
  }

  export type MarketUpdateToOneWithWhereWithoutReasoningTracesInput = {
    where?: MarketWhereInput
    data: XOR<MarketUpdateWithoutReasoningTracesInput, MarketUncheckedUpdateWithoutReasoningTracesInput>
  }

  export type MarketUpdateWithoutReasoningTracesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUpdateManyWithoutMarketNestedInput
    positions?: PositionUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateWithoutReasoningTracesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUncheckedUpdateManyWithoutMarketNestedInput
    positions?: PositionUncheckedUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type CopyTradeUpsertWithWhereUniqueWithoutTraceInput = {
    where: CopyTradeWhereUniqueInput
    update: XOR<CopyTradeUpdateWithoutTraceInput, CopyTradeUncheckedUpdateWithoutTraceInput>
    create: XOR<CopyTradeCreateWithoutTraceInput, CopyTradeUncheckedCreateWithoutTraceInput>
  }

  export type CopyTradeUpdateWithWhereUniqueWithoutTraceInput = {
    where: CopyTradeWhereUniqueInput
    data: XOR<CopyTradeUpdateWithoutTraceInput, CopyTradeUncheckedUpdateWithoutTraceInput>
  }

  export type CopyTradeUpdateManyWithWhereWithoutTraceInput = {
    where: CopyTradeScalarWhereInput
    data: XOR<CopyTradeUpdateManyMutationInput, CopyTradeUncheckedUpdateManyWithoutTraceInput>
  }

  export type SubscriptionUpsertWithWhereUniqueWithoutTraceInput = {
    where: SubscriptionWhereUniqueInput
    update: XOR<SubscriptionUpdateWithoutTraceInput, SubscriptionUncheckedUpdateWithoutTraceInput>
    create: XOR<SubscriptionCreateWithoutTraceInput, SubscriptionUncheckedCreateWithoutTraceInput>
  }

  export type SubscriptionUpdateWithWhereUniqueWithoutTraceInput = {
    where: SubscriptionWhereUniqueInput
    data: XOR<SubscriptionUpdateWithoutTraceInput, SubscriptionUncheckedUpdateWithoutTraceInput>
  }

  export type SubscriptionUpdateManyWithWhereWithoutTraceInput = {
    where: SubscriptionScalarWhereInput
    data: XOR<SubscriptionUpdateManyMutationInput, SubscriptionUncheckedUpdateManyWithoutTraceInput>
  }

  export type UserCreateWithoutCopyTradesInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutCopyTradesInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutCopyTradesInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutCopyTradesInput, UserUncheckedCreateWithoutCopyTradesInput>
  }

  export type ReasoningTraceCreateWithoutCopyTradesInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutReasoningTracesInput
    subscriptions?: SubscriptionCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceUncheckedCreateWithoutCopyTradesInput = {
    id?: string
    marketId: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    subscriptions?: SubscriptionUncheckedCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceCreateOrConnectWithoutCopyTradesInput = {
    where: ReasoningTraceWhereUniqueInput
    create: XOR<ReasoningTraceCreateWithoutCopyTradesInput, ReasoningTraceUncheckedCreateWithoutCopyTradesInput>
  }

  export type MarketCreateWithoutCopyTradesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeCreateNestedManyWithoutMarketInput
    positions?: PositionCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateWithoutCopyTradesInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeUncheckedCreateNestedManyWithoutMarketInput
    positions?: PositionUncheckedCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput
    agentLogs?: AgentLogUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketCreateOrConnectWithoutCopyTradesInput = {
    where: MarketWhereUniqueInput
    create: XOR<MarketCreateWithoutCopyTradesInput, MarketUncheckedCreateWithoutCopyTradesInput>
  }

  export type TradeCreateWithoutCopyTradesInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutTradesInput
    position?: PositionCreateNestedOneWithoutTradeInput
  }

  export type TradeUncheckedCreateWithoutCopyTradesInput = {
    id?: string
    marketId: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    position?: PositionUncheckedCreateNestedOneWithoutTradeInput
  }

  export type TradeCreateOrConnectWithoutCopyTradesInput = {
    where: TradeWhereUniqueInput
    create: XOR<TradeCreateWithoutCopyTradesInput, TradeUncheckedCreateWithoutCopyTradesInput>
  }

  export type UserUpsertWithoutCopyTradesInput = {
    update: XOR<UserUpdateWithoutCopyTradesInput, UserUncheckedUpdateWithoutCopyTradesInput>
    create: XOR<UserCreateWithoutCopyTradesInput, UserUncheckedCreateWithoutCopyTradesInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutCopyTradesInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutCopyTradesInput, UserUncheckedUpdateWithoutCopyTradesInput>
  }

  export type UserUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutUserNestedInput
  }

  export type ReasoningTraceUpsertWithoutCopyTradesInput = {
    update: XOR<ReasoningTraceUpdateWithoutCopyTradesInput, ReasoningTraceUncheckedUpdateWithoutCopyTradesInput>
    create: XOR<ReasoningTraceCreateWithoutCopyTradesInput, ReasoningTraceUncheckedCreateWithoutCopyTradesInput>
    where?: ReasoningTraceWhereInput
  }

  export type ReasoningTraceUpdateToOneWithWhereWithoutCopyTradesInput = {
    where?: ReasoningTraceWhereInput
    data: XOR<ReasoningTraceUpdateWithoutCopyTradesInput, ReasoningTraceUncheckedUpdateWithoutCopyTradesInput>
  }

  export type ReasoningTraceUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutReasoningTracesNestedInput
    subscriptions?: SubscriptionUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceUncheckedUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutTraceNestedInput
  }

  export type MarketUpsertWithoutCopyTradesInput = {
    update: XOR<MarketUpdateWithoutCopyTradesInput, MarketUncheckedUpdateWithoutCopyTradesInput>
    create: XOR<MarketCreateWithoutCopyTradesInput, MarketUncheckedCreateWithoutCopyTradesInput>
    where?: MarketWhereInput
  }

  export type MarketUpdateToOneWithWhereWithoutCopyTradesInput = {
    where?: MarketWhereInput
    data: XOR<MarketUpdateWithoutCopyTradesInput, MarketUncheckedUpdateWithoutCopyTradesInput>
  }

  export type MarketUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUpdateManyWithoutMarketNestedInput
    positions?: PositionUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUncheckedUpdateManyWithoutMarketNestedInput
    positions?: PositionUncheckedUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput
    agentLogs?: AgentLogUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type TradeUpsertWithoutCopyTradesInput = {
    update: XOR<TradeUpdateWithoutCopyTradesInput, TradeUncheckedUpdateWithoutCopyTradesInput>
    create: XOR<TradeCreateWithoutCopyTradesInput, TradeUncheckedCreateWithoutCopyTradesInput>
    where?: TradeWhereInput
  }

  export type TradeUpdateToOneWithWhereWithoutCopyTradesInput = {
    where?: TradeWhereInput
    data: XOR<TradeUpdateWithoutCopyTradesInput, TradeUncheckedUpdateWithoutCopyTradesInput>
  }

  export type TradeUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutTradesNestedInput
    position?: PositionUpdateOneWithoutTradeNestedInput
  }

  export type TradeUncheckedUpdateWithoutCopyTradesInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    position?: PositionUncheckedUpdateOneWithoutTradeNestedInput
  }

  export type UserCreateWithoutSubscriptionsInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutSubscriptionsInput = {
    id?: string
    walletAddress: string
    email?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutSubscriptionsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutSubscriptionsInput, UserUncheckedCreateWithoutSubscriptionsInput>
  }

  export type ReasoningTraceCreateWithoutSubscriptionsInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    market: MarketCreateNestedOneWithoutReasoningTracesInput
    copyTrades?: CopyTradeCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceUncheckedCreateWithoutSubscriptionsInput = {
    id?: string
    marketId: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutTraceInput
  }

  export type ReasoningTraceCreateOrConnectWithoutSubscriptionsInput = {
    where: ReasoningTraceWhereUniqueInput
    create: XOR<ReasoningTraceCreateWithoutSubscriptionsInput, ReasoningTraceUncheckedCreateWithoutSubscriptionsInput>
  }

  export type UserUpsertWithoutSubscriptionsInput = {
    update: XOR<UserUpdateWithoutSubscriptionsInput, UserUncheckedUpdateWithoutSubscriptionsInput>
    create: XOR<UserCreateWithoutSubscriptionsInput, UserUncheckedCreateWithoutSubscriptionsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutSubscriptionsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutSubscriptionsInput, UserUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type UserUpdateWithoutSubscriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutSubscriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    walletAddress?: StringFieldUpdateOperationsInput | string
    email?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutUserNestedInput
  }

  export type ReasoningTraceUpsertWithoutSubscriptionsInput = {
    update: XOR<ReasoningTraceUpdateWithoutSubscriptionsInput, ReasoningTraceUncheckedUpdateWithoutSubscriptionsInput>
    create: XOR<ReasoningTraceCreateWithoutSubscriptionsInput, ReasoningTraceUncheckedCreateWithoutSubscriptionsInput>
    where?: ReasoningTraceWhereInput
  }

  export type ReasoningTraceUpdateToOneWithWhereWithoutSubscriptionsInput = {
    where?: ReasoningTraceWhereInput
    data: XOR<ReasoningTraceUpdateWithoutSubscriptionsInput, ReasoningTraceUncheckedUpdateWithoutSubscriptionsInput>
  }

  export type ReasoningTraceUpdateWithoutSubscriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    market?: MarketUpdateOneRequiredWithoutReasoningTracesNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceUncheckedUpdateWithoutSubscriptionsInput = {
    id?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTraceNestedInput
  }

  export type MarketCreateWithoutAgentLogsInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeCreateNestedManyWithoutMarketInput
    positions?: PositionCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeCreateNestedManyWithoutMarketInput
  }

  export type MarketUncheckedCreateWithoutAgentLogsInput = {
    id?: string
    question: string
    category: $Enums.MarketCategory
    status?: $Enums.MarketStatus
    settlementCurrency?: $Enums.SettlementCurrency
    initialYesProb: number
    currentYesProb?: number | null
    confidenceInterval: JsonNullValueInput | InputJsonValue
    expiryTimestamp: Date | string
    resolutionOracle?: string | null
    minimumLiquidity?: number
    totalLiquidity?: number
    onChainAddress?: string | null
    txHash?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    trades?: TradeUncheckedCreateNestedManyWithoutMarketInput
    positions?: PositionUncheckedCreateNestedManyWithoutMarketInput
    reasoningTraces?: ReasoningTraceUncheckedCreateNestedManyWithoutMarketInput
    copyTrades?: CopyTradeUncheckedCreateNestedManyWithoutMarketInput
  }

  export type MarketCreateOrConnectWithoutAgentLogsInput = {
    where: MarketWhereUniqueInput
    create: XOR<MarketCreateWithoutAgentLogsInput, MarketUncheckedCreateWithoutAgentLogsInput>
  }

  export type MarketUpsertWithoutAgentLogsInput = {
    update: XOR<MarketUpdateWithoutAgentLogsInput, MarketUncheckedUpdateWithoutAgentLogsInput>
    create: XOR<MarketCreateWithoutAgentLogsInput, MarketUncheckedCreateWithoutAgentLogsInput>
    where?: MarketWhereInput
  }

  export type MarketUpdateToOneWithWhereWithoutAgentLogsInput = {
    where?: MarketWhereInput
    data: XOR<MarketUpdateWithoutAgentLogsInput, MarketUncheckedUpdateWithoutAgentLogsInput>
  }

  export type MarketUpdateWithoutAgentLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUpdateManyWithoutMarketNestedInput
    positions?: PositionUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutMarketNestedInput
  }

  export type MarketUncheckedUpdateWithoutAgentLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    question?: StringFieldUpdateOperationsInput | string
    category?: EnumMarketCategoryFieldUpdateOperationsInput | $Enums.MarketCategory
    status?: EnumMarketStatusFieldUpdateOperationsInput | $Enums.MarketStatus
    settlementCurrency?: EnumSettlementCurrencyFieldUpdateOperationsInput | $Enums.SettlementCurrency
    initialYesProb?: FloatFieldUpdateOperationsInput | number
    currentYesProb?: NullableFloatFieldUpdateOperationsInput | number | null
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    expiryTimestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    resolutionOracle?: NullableStringFieldUpdateOperationsInput | string | null
    minimumLiquidity?: FloatFieldUpdateOperationsInput | number
    totalLiquidity?: FloatFieldUpdateOperationsInput | number
    onChainAddress?: NullableStringFieldUpdateOperationsInput | string | null
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trades?: TradeUncheckedUpdateManyWithoutMarketNestedInput
    positions?: PositionUncheckedUpdateManyWithoutMarketNestedInput
    reasoningTraces?: ReasoningTraceUncheckedUpdateManyWithoutMarketNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutMarketNestedInput
  }

  export type SubscriptionCreateManyUserInput = {
    id?: string
    traceId?: string | null
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateManyUserInput = {
    id?: string
    traceId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trace?: ReasoningTraceUpdateOneWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: NullableStringFieldUpdateOperationsInput | string | null
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trace?: ReasoningTraceUpdateOneRequiredWithoutCopyTradesNestedInput
    market?: MarketUpdateOneRequiredWithoutCopyTradesNestedInput
    trade?: TradeUpdateOneWithoutCopyTradesNestedInput
  }

  export type CopyTradeUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TradeCreateManyMarketInput = {
    id?: string
    direction: $Enums.TradeDirection
    status?: $Enums.TradeStatus
    amount: number
    price: number
    edgeDetected: number
    kellyFraction: number
    txHash?: string | null
    builderFee?: number
    errorMessage?: string | null
    executedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type PositionCreateManyMarketInput = {
    id?: string
    tradeId: string
    direction: $Enums.TradeDirection
    status?: $Enums.PositionStatus
    entryPrice: number
    currentPrice?: number | null
    size: number
    pnl?: number
    hedgeMarketId?: string | null
    closedAt?: Date | string | null
    closeReason?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ReasoningTraceCreateManyMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    decisionType: string
    sourcesUsed: JsonNullValueInput | InputJsonValue
    probabilityEstimate: number
    marketProbability: number
    edge: number
    confidenceInterval: JsonNullValueInput | InputJsonValue
    betFraction?: number | null
    betSizeUsdc?: number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: string | null
    signature?: string | null
    ipfsCid?: string | null
    sha256Hash?: string | null
    onChainTxHash?: string | null
    verified?: boolean
    isPublic?: boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeCreateManyMarketInput = {
    id?: string
    userId: string
    traceId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AgentLogCreateManyMarketInput = {
    id?: string
    agentType: $Enums.AgentType
    level?: $Enums.LogLevel
    action: string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: string | null
    createdAt?: Date | string
  }

  export type TradeUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    position?: PositionUpdateOneWithoutTradeNestedInput
    copyTrades?: CopyTradeUpdateManyWithoutTradeNestedInput
  }

  export type TradeUncheckedUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    position?: PositionUncheckedUpdateOneWithoutTradeNestedInput
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTradeNestedInput
  }

  export type TradeUncheckedUpdateManyWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    amount?: FloatFieldUpdateOperationsInput | number
    price?: FloatFieldUpdateOperationsInput | number
    edgeDetected?: FloatFieldUpdateOperationsInput | number
    kellyFraction?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    errorMessage?: NullableStringFieldUpdateOperationsInput | string | null
    executedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PositionUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    trade?: TradeUpdateOneRequiredWithoutPositionNestedInput
  }

  export type PositionUncheckedUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    tradeId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PositionUncheckedUpdateManyWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    tradeId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    status?: EnumPositionStatusFieldUpdateOperationsInput | $Enums.PositionStatus
    entryPrice?: FloatFieldUpdateOperationsInput | number
    currentPrice?: NullableFloatFieldUpdateOperationsInput | number | null
    size?: FloatFieldUpdateOperationsInput | number
    pnl?: FloatFieldUpdateOperationsInput | number
    hedgeMarketId?: NullableStringFieldUpdateOperationsInput | string | null
    closedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    closeReason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ReasoningTraceUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUpdateManyWithoutTraceNestedInput
    subscriptions?: SubscriptionUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceUncheckedUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    copyTrades?: CopyTradeUncheckedUpdateManyWithoutTraceNestedInput
    subscriptions?: SubscriptionUncheckedUpdateManyWithoutTraceNestedInput
  }

  export type ReasoningTraceUncheckedUpdateManyWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    decisionType?: StringFieldUpdateOperationsInput | string
    sourcesUsed?: JsonNullValueInput | InputJsonValue
    probabilityEstimate?: FloatFieldUpdateOperationsInput | number
    marketProbability?: FloatFieldUpdateOperationsInput | number
    edge?: FloatFieldUpdateOperationsInput | number
    confidenceInterval?: JsonNullValueInput | InputJsonValue
    betFraction?: NullableFloatFieldUpdateOperationsInput | number | null
    betSizeUsdc?: NullableFloatFieldUpdateOperationsInput | number | null
    hedgeConditions?: NullableJsonNullValueInput | InputJsonValue
    agentWallet?: NullableStringFieldUpdateOperationsInput | string | null
    signature?: NullableStringFieldUpdateOperationsInput | string | null
    ipfsCid?: NullableStringFieldUpdateOperationsInput | string | null
    sha256Hash?: NullableStringFieldUpdateOperationsInput | string | null
    onChainTxHash?: NullableStringFieldUpdateOperationsInput | string | null
    verified?: BoolFieldUpdateOperationsInput | boolean
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    previewSources?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutCopyTradesNestedInput
    trace?: ReasoningTraceUpdateOneRequiredWithoutCopyTradesNestedInput
    trade?: TradeUpdateOneWithoutCopyTradesNestedInput
  }

  export type CopyTradeUncheckedUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUncheckedUpdateManyWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogUncheckedUpdateWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AgentLogUncheckedUpdateManyWithoutMarketInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentType?: EnumAgentTypeFieldUpdateOperationsInput | $Enums.AgentType
    level?: EnumLogLevelFieldUpdateOperationsInput | $Enums.LogLevel
    action?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    error?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeCreateManyTradeInput = {
    id?: string
    userId: string
    traceId: string
    marketId: string
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeUpdateWithoutTradeInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutCopyTradesNestedInput
    trace?: ReasoningTraceUpdateOneRequiredWithoutCopyTradesNestedInput
    market?: MarketUpdateOneRequiredWithoutCopyTradesNestedInput
  }

  export type CopyTradeUncheckedUpdateWithoutTradeInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUncheckedUpdateManyWithoutTradeInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    traceId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeCreateManyTraceInput = {
    id?: string
    userId: string
    marketId: string
    tradeId?: string | null
    direction: $Enums.TradeDirection
    amount: number
    txHash?: string | null
    builderFee?: number
    status?: $Enums.TradeStatus
    pnl?: number | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type SubscriptionCreateManyTraceInput = {
    id?: string
    userId: string
    type: $Enums.SubscriptionType
    status?: $Enums.SubscriptionStatus
    amountPaid: number
    currency?: string
    txHash?: string | null
    expiresAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type CopyTradeUpdateWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutCopyTradesNestedInput
    market?: MarketUpdateOneRequiredWithoutCopyTradesNestedInput
    trade?: TradeUpdateOneWithoutCopyTradesNestedInput
  }

  export type CopyTradeUncheckedUpdateWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type CopyTradeUncheckedUpdateManyWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    marketId?: StringFieldUpdateOperationsInput | string
    tradeId?: NullableStringFieldUpdateOperationsInput | string | null
    direction?: EnumTradeDirectionFieldUpdateOperationsInput | $Enums.TradeDirection
    amount?: FloatFieldUpdateOperationsInput | number
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    builderFee?: FloatFieldUpdateOperationsInput | number
    status?: EnumTradeStatusFieldUpdateOperationsInput | $Enums.TradeStatus
    pnl?: NullableFloatFieldUpdateOperationsInput | number | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionUpdateWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutSubscriptionsNestedInput
  }

  export type SubscriptionUncheckedUpdateWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type SubscriptionUncheckedUpdateManyWithoutTraceInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    type?: EnumSubscriptionTypeFieldUpdateOperationsInput | $Enums.SubscriptionType
    status?: EnumSubscriptionStatusFieldUpdateOperationsInput | $Enums.SubscriptionStatus
    amountPaid?: FloatFieldUpdateOperationsInput | number
    currency?: StringFieldUpdateOperationsInput | string
    txHash?: NullableStringFieldUpdateOperationsInput | string | null
    expiresAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}