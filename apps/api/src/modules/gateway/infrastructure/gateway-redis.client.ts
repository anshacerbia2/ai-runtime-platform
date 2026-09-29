import {
  runtimeRedisClient,
  type RuntimeRedisClient,
} from '../../../infrastructure/redis/runtime-redis.client.js';

/**
 * Startup fails after one retry so a pod never advertises a Redis-backed
 * gateway while its hot tier is absent. After the first healthy connection,
 * the client keeps reconnecting with bounded backoff. Offline commands still
 * fail immediately; PostgreSQL remains the execution authority.
 */
export const gatewayRedisClient = runtimeRedisClient;
export type GatewayRedisClient = RuntimeRedisClient;
