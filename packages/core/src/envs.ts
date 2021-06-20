export const envs = {
  redisUrl: process.env.REDIS_URL || 'localhost',
  redisPort: process.env.REDIS_PORT ? +process.env.REDIS_PORT : 6379,
  gatewayPort: process.env.GATEWAY_PORT ? +process.env.GATEWAY_PORT : 3002,
  gatewayName: process.env.GATEWAY_NAME || 'main',
};
