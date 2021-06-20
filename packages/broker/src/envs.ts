export const envs = {
  redisUrl: process.env.REDIS_URL || 'localhost',
  redisPort: process.env.REDIS_PORT ? +process.env.REDIS_PORT : 6379,
  brokerPort: process.env.BROKER_PORT ? +process.env.BROKER_PORT : 3001,
};
