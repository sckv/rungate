import fetch from 'node-fetch';
import { print, DocumentNode, GraphQLSchema, buildSchema } from 'graphql';
import { BareHttp, BareHttpType, logMe } from 'barehttp';
import { stitchSchemas } from '@graphql-tools/stitch';
import ioredis from 'ioredis';

import { graphqlHTTP } from './graphql-connect';
import { envs } from './envs';

import http from 'http';
import https from 'https';

const httpAgent = new http.Agent();
const httpsAgent = new https.Agent();

const getUrlAgent = (url: string) => {
  const urlHead = url.split(':')[0];
  if (urlHead === 'http') {
    return httpAgent;
  } else if (urlHead === 'https') {
    return httpsAgent;
  }
};

export class RunGate {
  private schemas: Map<string, { schema: GraphQLSchema; executor: any }> = new Map();
  private runtimeSchema?: GraphQLSchema;
  private redis: ioredis.Redis;
  private app: BareHttpType;
  private brokerKey: string;

  constructor(private readonly gateway: string = envs.gatewayName) {
    this.brokerKey = `schema:${this.gateway}`;
    this.app = new BareHttp({ serverPort: envs.gatewayPort });
    this.redis = new ioredis({ port: envs.redisPort, host: envs.redisUrl }).on('ready', () =>
      console.log('Redis connected'),
    );

    this.redis.config('SET', 'notify-keyspace-events', 'AKE');

    this.listenToRedis();
  }

  start(cb?: (address?: string) => void) {
    this.buildAtStart();
    return this.app.start(cb);
  }

  stop() {
    return this.app.stop();
  }

  async createRemoteExecutor(url: string) {
    const agent = getUrlAgent(url);
    return async function remoteExecutor({
      document,
      variables,
    }: {
      document: DocumentNode;
      variables: any;
    }) {
      const query = print(document);
      const fetchResult = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        agent,
      });
      return fetchResult.json();
    };
  }

  private async buildSchemaFromRedis() {
    const rawSchemas = await this.redis.get(this.brokerKey);
    if (!rawSchemas) {
      logMe.fatal(`There are no schemas published for ${this.brokerKey}. Will retry in 5 sec`);
      throw new Error('No schemas to rebuild, check if broker is online');
    }
    const schemas = JSON.parse(rawSchemas) as {
      hash: string;
      name: string;
      schema: string;
      url: string;
    }[];

    schemas.forEach((s) => {
      this.schemas.set(s.name, {
        schema: buildSchema(s.schema),
        executor: this.createRemoteExecutor(s.url),
      });
    });
    this.stitchSchemas();
    logMe.info('Successfully built schema from redis');
    return true;
  }

  private async buildAtStart() {
    const schemaUplink = await this.buildSchemaFromRedis().catch((e) => {
      logMe.error(e);
      this.retryStartup();
    });
    if (schemaUplink) {
      this.attachGraphqlRoutes();
      logMe.info('Successfully started with new schema');
    }
  }

  private async rebuildAndHotSwap() {
    const schemaUplink = await this.buildSchemaFromRedis().catch((e) => {
      logMe.error(e);
      this.retryHotSwap();
    });

    if (schemaUplink) {
      this.hotSwapSchemaEndpoints();
      logMe.info('Successfully hot swapped to the new schema');
    }
  }

  private retryStartup(time = 5000) {
    setTimeout(() => {
      this.buildAtStart();
    }, time);
  }

  private retryHotSwap(time = 5000) {
    setTimeout(() => {
      this.rebuildAndHotSwap();
    }, time);
  }

  private listenToRedis() {
    const dupe = this.redis.duplicate();
    dupe.on('ready', () => {
      dupe.subscribe('__keyevent@0__:set');
      dupe.on('message', (_, key) => {
        if (this.brokerKey === key) {
          this.rebuildAndHotSwap().catch((err) => {
            logMe.error('Error hot swapping new version of the schema', err);
          });
        }
      });
    });
  }

  private stitchSchemas() {
    this.runtimeSchema = stitchSchemas({
      subschemas: [...this.schemas.values()],
    });
  }

  private attachGraphqlRoutes() {
    this.app.declare({
      route: '/graphql',
      handler: graphqlHTTP({ schema: this.runtimeSchema!, graphiql: true }),
      methods: ['get', 'post'],
    });
  }

  private hotSwapSchemaEndpoints() {
    this.app.runtimeRoute.declare({
      route: '/graphql',
      handler: graphqlHTTP({ schema: this.runtimeSchema!, graphiql: true }),
      methods: ['get', 'post'],
    });
  }
}
