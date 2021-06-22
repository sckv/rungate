import fetch from 'node-fetch';
import debounce from 'lodash/debounce';

import fs from 'fs';

const gitRev = () => {
  try {
    const rev = fs.readFileSync('.git/HEAD').toString().trim();

    if (rev.indexOf(':') === -1) {
      return rev;
    } else {
      return fs
        .readFileSync('.git/' + rev.substring(5))
        .toString()
        .trim();
    }
  } catch (e) {
    console.error(e);
    console.log(
      'You have to have git repository initialized in the service root. Or provide a versioned hash.',
    );
  }
};

const attachDeregister = (call: (code: any) => any) => {
  process.on('beforeExit', (code) => call(code));
  process.on('exit', (code) => call(code));
  process.on('SIGINT', (code) => call(code));
  process.on('SIGQUIT', (code) => call(code));
  process.on('SIGTERM', (code) => call(code));
};

export const announceMySchema = async (
  options?: Partial<{
    hash: string;
    name: string;
    url: string;
    gateway: string;
    gatewayUrl: string;
  }>,
) => {
  const hash = options?.hash || process.env.SERVICE_HASH || gitRev();
  const name = options?.name || process.env.SERVICE_NAME;
  const url = options?.url || process.env.SERVICE_URL;
  const gateway = options?.gateway || process.env.SERVICE_GATEWAY;
  const gatewayUrl = options?.gatewayUrl || process.env.SERVICE_GATEWAY_URL;

  if (!name || !url || !gateway || !hash || !gatewayUrl) {
    throw new Error(
      `You need to define all four environment variables to be able to work with this service.\nGot name ${name}, hash ${hash}, url ${url}, gateway ${gateway}\nReview your envs`,
    );
  }

  fetch(`${gatewayUrl}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, name, url, gateway }),
  })
    .then((res) => {
      if (res.ok) {
        console.log(`Service ${name} registered to gateway ${gateway}`);
        return res.json();
      }
      res.json().then((jsoned) => {
        console.log({ errorFromGateway: jsoned });
        throw Error(`Bad status from gateway ${res.status}`);
      });
    })
    .catch(console.error)
    .then(console.log);

  let deregistered = false;

  const deregisterCall = (code: any) => {
    if (deregistered) return process.exit(code);

    fetch(`${gatewayUrl}/deregister`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash, name, url, gateway }),
    })
      .then((res) => {
        deregistered = true;
        if (res.ok) return res.json();
        res.json().then((jsoned) => {
          console.log({ errorFromGateway: jsoned });
          throw Error(`Bad status from gateway ${res.status}`);
        });
      })
      .catch((e) => {
        deregistered = true;
        console.error(e);
      })
      .then(console.log);
  };

  const debounced = debounce(deregisterCall, 5);

  attachDeregister(debounced);
};
