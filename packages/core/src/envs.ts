export const envs = {
  redisUrl: process.env.REDIS_URL || 'localhost',
  redisPort: process.env.REDIS_PORT ? +process.env.REDIS_PORT : 6773,
  gatewayPort: process.env.GATEWAY_PORT ? +process.env.GATEWAY_PORT : 3001,
  gatewayName: process.env.GATEWAY_NAME || 'main',
};
