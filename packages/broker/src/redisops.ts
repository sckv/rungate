import type ioredis from 'ioredis';

const rKeys = {
  triage: 't',
  lock: 'l',
  schema: 'schema',
  status: 'st',
  services: 's',
  child: 'c',
  metadata: 'm',
};

export const redisOps = (r: ioredis.Redis) => ({
  addGatewayData: (
    gateway: string,
    services: { hash: string; name: string; schema: string; url: string }[],
  ) => {
    // schema:<gateway> -> services[]
    return r.setnx(`${rKeys.schema}:${gateway}`, JSON.stringify(services));
  },

  addGatewayDataOverride: (
    gateway: string,
    services: { hash: string; name: string; schema: string; url: string }[],
  ) => {
    // schema:<gateway> -> services[]
    return r.set(`${rKeys.schema}:${gateway}`, JSON.stringify(services));
  },
  getGatewayData: async (gateway: string) => {
    const rawServices = await r.get(`${rKeys.schema}:${gateway}`);
    if (!rawServices) return null;
    return JSON.parse(rawServices) as { hash: string; schema: string; name: string; url: string }[];
  },

  // addTriageData: (gateway: string, hash: string) => {
  //   // schema:triage:<gateway> -> hash
  //   return r.rpush(`${rKeys.schema}:${rKeys.triage}:${gateway}`, hash);
  // },
  setTriageParent: (gateway: string, parentHash: string, childHash: string) => {
    // schema:triage:<gateway>:child:<parentHash> -> childHash
    return r.set(
      `${rKeys.schema}:${rKeys.triage}:${gateway}:${rKeys.child}:${parentHash}`,
      childHash,
    );
  },
  getTriageChild: (gateway: string, parentHash: string) => {
    // schema:triage:<gateway>:child:<parentHash> -> childHash
    return r.get(`${rKeys.schema}:${rKeys.triage}:${gateway}:${rKeys.child}:${parentHash}`);
  },
  removeTriageParent: (gateway: string, parentHash: string) => {
    // schema:triage:<gateway>:child:<parentHash>
    return r.del(`${rKeys.schema}:${rKeys.triage}:${gateway}:${rKeys.child}:${parentHash}`);
  },
  addHashTriage: (
    gateway: string,
    hash: string,
    service: { name: string; schema: string; url: string },
  ) => {
    // schema:triage:<gateway>:<hash> -> service
    return r.setnx(`${rKeys.schema}:${rKeys.triage}:${gateway}:${hash}`, JSON.stringify(service));
  },
  getHashSingleTriage: (gateway: string, hash: string) => {
    // schema:triage:<gateway>:<hash> -> service
    const key = `${rKeys.schema}:${rKeys.triage}:${gateway}:${hash}`;
    return new Promise<{ hash: string; name: string; schema: string; url: string }>(
      (resolve, rej) => {
        r.multi([
          ['get', key],
          ['del', key],
        ]).exec((err, res) => {
          if (err) rej(err);
          if (res[0][0]) rej(err);
          resolve(JSON.parse(res[0][1]));
        });
      },
    );
  },

  // services related
  incrHashServiceCount: (gateway: string, hash: string) => {
    return r.incr(`${rKeys.schema}:${gateway}:${rKeys.services}:${hash}`);
  },
  decrHashServiceCount: async (gateway: string, hash: string) => {
    const key = `${rKeys.schema}:${gateway}:${rKeys.services}:${hash}`;
    const servicesLeft = await r.decr(key);
    if (servicesLeft <= 0) {
      await r.del(key);
      return -1;
    }
    return servicesLeft;
  },

  // lock
  setLockState: async () => {
    const result = await r.setnx(`${rKeys.schema}:${rKeys.lock}`, '1');
    console.log({ result });
    if (result != 1) {
      throw new Error('Lock not acquired');
    }
  },
  removeLockState: () => {
    return r.del(`${rKeys.schema}:${rKeys.lock}`);
  },
});
