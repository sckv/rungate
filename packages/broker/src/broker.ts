import { introspectSchema } from '@graphql-tools/wrap';
import { diff, CriticalityLevel } from '@graphql-inspector/core';
import fetch from 'node-fetch';
import { print, DocumentNode, printIntrospectionSchema, buildSchema, printSchema } from 'graphql';
import { BareHttp, BareHttpType, BareRequest } from 'barehttp';
import ioredis from 'ioredis';
import { mergeSchemas } from '@graphql-tools/merge';

import { redisOps } from './redisops';
import { envs } from './envs';

export class RunGateBroker {
  private runtimeSchemaStore: Map<
    string, // gateway
    { hash: string; name: string; schema: string; url: string }[]
  > = new Map();

  private redis: ioredis.Redis;
  private app: BareHttpType;

  constructor() {
    this.app = new BareHttp({ serverPort: envs.brokerPort });
    this.redis = new ioredis({
      port: envs.redisPort,
      host: envs.redisUrl,
    }).on('ready', () => console.log('Redis connected!'));
    this.attachRegisterRoute();
  }

  start(cb?: (address?: string) => void) {
    return this.app.start(cb);
  }

  stop() {
    return this.app.stop();
  }

  async createRemoteExecutor(url: string) {
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
      });
      return fetchResult.json();
    };
  }

  private async registerHandler(flow: BareRequest, rOps: ReturnType<typeof redisOps>) {
    if (!flow.requestBody) throw new Error('Cant submit empty body to register');
    // TODO: to change to the remote IP?
    console.log({ remoteIp: flow.remoteIp });
    const { name, url, hash, gateway } = flow.requestBody;

    const executor = await this.createRemoteExecutor(url);
    const schemaToRegister = await introspectSchema(executor as any);

    const schemaToRegisterString = printSchema(schemaToRegister);

    const services = await rOps.getGatewayData(gateway);

    if (!services) {
      // publish service for the gateway
      try {
        await rOps.setLockState();

        const addGatewayData = rOps.addGatewayData(gateway, [
          { name, schema: schemaToRegisterString, url, hash },
        ]);
        const addHashClient = rOps.incrHashServiceCount(gateway, hash);
        await Promise.all([addGatewayData, addHashClient]);
        this.runtimeSchemaStore.set(gateway, [{ name, schema: schemaToRegisterString, url, hash }]);
        await rOps.removeLockState();
        console.log(`Correctly initialized new gateway ${gateway} with first service ${name}`);
      } catch (e) {
        console.log('Failed to acquire the lock over the gateway initial data set');
        console.log({ error: e });
        await rOps.removeLockState();
        // TODO: solve retry problem for the locked state
      }
      return { status: 'REGISTRATION_SUCCESS', name, url, hash, gateway }; //return that the registration went OK
    }

    const isSameService = services.find(
      ({ name: sName, hash: sHash }) => sName === name && sHash === hash,
    );

    if (isSameService) {
      await rOps.incrHashServiceCount(gateway, hash);
      return { status: 'REGISTRATION_SUCCESS', name, url, hash, gateway }; //return that the registration went OK
    }

    let isBreaking = false;

    const graphedServices = services.map((service) => ({
      ...service,
      graph: buildSchema(service.schema),
    }));

    const storedSchema = mergeSchemas({
      schemas: graphedServices.map((ss) => ss.graph),
    });

    const filterSameService = graphedServices
      .filter((gs) => gs.name !== name)
      .map((gs) => gs.graph);

    const nextSchema = mergeSchemas({ schemas: filterSameService.concat(schemaToRegister) });
    const diffed = diff(storedSchema, nextSchema);

    const findBreaking = diffed.filter((d) => d.criticality.level === CriticalityLevel.Breaking);

    if (findBreaking.length) {
      isBreaking = true;
      console.log('Following fields are breaking from the incoming schema');
      findBreaking.forEach((v) =>
        console.log(`Message => ${v.message}\nPath => ${v.path}\nType => ${v.type}`),
      );
    }
    console.log('is breaking');

    const clientInList = services.find(({ name: sName, url: sUrl }) => sName === name);

    // its a new service to add or swap
    const newService = {
      name,
      url,
      hash,
      schema: printSchema(schemaToRegister),
      parent: clientInList!.hash || undefined,
    };
    // console.log({ clientInList });
    // const mismatchedClient = services.find(
    //   ({ name: sName, url: sUrl }) =>
    //     (sName === name && sUrl !== url) || (sName !== name && sUrl === url),
    // );

    // if (!clientInList && mismatchedClient) {
    //   console.error(
    //     `Mismatched client!\nStored: ${mismatchedClient[0]} - ${mismatchedClient[1]}\nReceived: ${name} - ${url}`,
    //   );
    //   throw new Error(`Mismatched client, review ${name} service configuration`);
    // }

    // ! Note #1 - this is a failsafe for schema breaking services
    if (!clientInList && isBreaking) {
      console.error(
        `Rejected new service ${name} with url ${url} and hash ${hash} - it is breaking the existing schema. Review it's contract.`,
      );
      throw new Error(`Rejected broker integration for service ${name} with url ${url}`);
    }

    if (!isBreaking) {
      //  case when the schema is not a breaking candidate
      const newServices = clientInList
        ? services.map((s) => {
            if (s.name === name) {
              return newService;
            }
            return s;
          })
        : services.concat(newService);

      try {
        await rOps.setLockState();
        await rOps.addGatewayDataOverride(gateway, newServices);
        this.runtimeSchemaStore.set(gateway, newServices);
        await rOps.incrHashServiceCount(gateway, hash);
        await rOps.removeLockState();
        return { status: 'REGISTRATION_SUCCESS', name, url, hash, gateway }; //return that the registration went OK
      } catch (e) {
        console.log('Failed to acquire the lock over the gateway data');
        console.log({ error: e });
        await rOps.removeLockState();
        // TODO: solve retry problem for the locked state
      }
    } else {
      console.log('IS BREAKING BERSION OF THE NEW SERVICE');

      // if the schema is breaking we have to triage breaking swapping service
      try {
        await rOps.setLockState();
        await rOps.addHashTriage(gateway, hash, newService);
        await rOps.setTriageParent(gateway, clientInList!.hash, hash); // clientInList should NEVER be empty, review Note #1
        await rOps.incrHashServiceCount(gateway, hash);
        await rOps.removeLockState();
        console.log('Added schema to the triage');
        return { status: 'REGISTRATION_SUCCESS', name, url, hash, gateway }; //return that the registration went OK
      } catch (e) {
        console.log('Failed to acquire the lock over the triage data');
        console.log({ error: e });
        await rOps.removeLockState();
        // TODO: solve retry problem for the locked state
      }
    }
  }

  private async deregisterHandler(flow: BareRequest, rOps: ReturnType<typeof redisOps>) {
    if (!flow.requestBody) throw new Error('Cant submit empty body to register');
    // TODO: to change to the remote IP?
    console.log({ remoteIp: flow.remoteIp });

    const { name, hash, gateway, url } = flow.requestBody;

    const registeredServices = await rOps.getGatewayData(gateway);
    if (!registeredServices) {
      throw new Error('There is no entry in the broker about this gateway');
    }

    const runningService = registeredServices.find((c) => c.hash === hash);

    if (!runningService) {
      console.warn(
        `Could not find a client to deregister for gateway ${gateway} with name ${name} and hash ${hash}. Probably it's a service in triage.`,
      );
      await rOps.decrHashServiceCount(gateway, hash);
      await rOps.deleteSingleTriage(gateway, hash);

      const isTriagedService = await rOps.getSingleTriage(gateway, hash);
      if (isTriagedService && isTriagedService.parent) {
        await rOps.removeTriageChild(gateway, isTriagedService.parent);
      }
      return { status: 'DE_REGISTRATION_SUCCESS', name, hash, gateway };
    }

    const result = await rOps.decrHashServiceCount(gateway, hash);

    if (result !== -1) {
      console.warn(
        `Successfully deregistered 1 service for gateway ${gateway} with name ${name} and hash ${hash}, ${result} left active`,
      );
      return { status: 'DE_REGISTRATION_SUCCESS', name, hash, gateway };
    }

    const childHash = await rOps.getTriageChild(gateway, hash);

    const substitutionService = childHash
      ? await rOps.getAndDeleteSingleTriage(gateway, childHash)
      : null;

    const newServices = !substitutionService
      ? registeredServices.filter((s) => {
          if (s.name === name) {
            return false;
          }
          return true;
        })
      : registeredServices.map((s) => {
          if (s.name === substitutionService.name) {
            return substitutionService;
          }
          return s;
        });

    if (!childHash) {
      console.error(
        `Seems ${name} service with hash ${hash} is not having a successor.\nPlease find out if it's intended.`,
      );
    }

    const deregister = async () => {
      try {
        await rOps.setLockState();
        if (newServices.length) {
          await rOps.addGatewayDataOverride(gateway, newServices);
        } else {
          await rOps.removeGatewayData(gateway);
        }
        this.runtimeSchemaStore.set(gateway, newServices);
        if (substitutionService?.parent) {
          await rOps.removeTriageChild(gateway, substitutionService?.parent);
        }
        await rOps.removeLockState();
        const log = newServices.length
          ? `Service ${name} with hash ${hash} correctly substituted for new version of ${childHash}`
          : `Service ${name} with hash ${hash} correctly wiped from the gateway ${gateway}`;
        console.log(log);
      } catch (e) {
        console.log('Failed to acquire the lock over the gateway data');
        console.log({ error: e });
        await rOps.removeLockState();
        // TODO: solve retry problem for the locked state
      }
    };

    // TODO: make it repeatable until success
    await deregister();

    return { status: 'DE_REGISTRATION_SUCCESS', name, hash, gateway };
  }

  private attachRegisterRoute() {
    const rOps = redisOps(this.redis);
    this.app
      .post({
        route: '/register',
        handler: (flow) => this.registerHandler(flow, rOps),
      })
      .post({
        route: '/deregister',
        handler: (flow) => this.deregisterHandler(flow, rOps),
      })
      .get({
        // to return all schemas sync
        route: '/schemas/:gateway',
        handler: (flow) => {
          if (!flow.params.gateway) {
            flow.sendStatus(404);
            return;
          }
          const runtimeSchemas = this.runtimeSchemaStore.get(flow.params.gateway!);
          if (!runtimeSchemas) {
            flow.sendStatus(404);
            return;
          }

          flow.json(runtimeSchemas);
        },
      });
  }
}
