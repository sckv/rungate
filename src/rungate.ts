import { introspectSchema } from '@graphql-tools/wrap';
import fetch from 'node-fetch';
import { print, DocumentNode, GraphQLSchema } from 'graphql';
import { BareHttp } from 'barehttp';
import { graphqlHTTP } from './graphql-connect';
import { stitchSchemas } from '@graphql-tools/stitch';
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
  private app: BareHttp<any>;
  private schemas: Map<string, any> = new Map();
  private runtimeSchema?: GraphQLSchema;

  constructor() {
    this.app = new BareHttp({ serverPort: 3001 });
  }

  stitchSchemas() {
    this.runtimeSchema = stitchSchemas({
      subschemas: [...this.schemas.values()],
    });
  }

  start(cb?: (address?: string) => void) {
    this.stitchSchemas();
    if (this.runtimeSchema) {
      this.attachGraphqlRoutes(graphqlHTTP({ schema: this.runtimeSchema!, graphiql: true }));
    }
    return this.app.start(cb);
  }

  stop() {
    return this.app.stop();
  }

  async createRemoteExecutor(name: string, url: string) {
    const agent = getUrlAgent(url);
    async function remoteExecutor({
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
    }

    this.schemas.set(name, {
      schema: await introspectSchema(remoteExecutor as any),
      executor: remoteExecutor,
    });
  }

  private attachGraphqlRoutes(graphqlHandler: any) {
    this.app.route.get({
      route: '/graphql',
      handler: graphqlHandler,
    });
    this.app.route.post({
      route: '/graphql',
      handler: graphqlHandler,
    });
  }
}
