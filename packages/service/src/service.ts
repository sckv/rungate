import fetch from 'node-fetch';

import fs from 'fs';

export const announceMySchema = async (
  options?: Partial<{
    hash: string;
    name: string;
    url: string;
    gateway: string;
    gatewayUrl: string;
  }>,
) => {
  const rev = fs.readFileSync('.git/HEAD').toString().trim();
  const getRev = () => {
    if (rev.indexOf(':') === -1) {
      return rev;
    } else {
      return fs
        .readFileSync('.git/' + rev.substring(5))
        .toString()
        .trim();
    }
  };

  const hash = options?.hash || process.env.SERVICE_HASH || getRev();
  const name = options?.name || process.env.SERVICE_NAME;
  const url = options?.url || process.env.SERVICE_URL;
  const gateway = options?.gateway || process.env.SERVICE_GATEWAY;
  const gatewayUrl = options?.gatewayUrl || process.env.SERVICE_GATEWAY_URL;

  if (!name || !url || !gateway || !hash || !gatewayUrl) {
    throw new Error(
      `You need to define all four environment variables to be able to work with this service.\nGot name ${name}, hash ${hash}, url ${url}, gateway ${gateway}\nReview your envs`,
    );
  }

  fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, name, url, gateway }),
  }).then((res) => {
    if (res.ok) return res.json();
    res.json().then((jsoned) => {
      console.log({ errorFromGateway: jsoned });
      throw Error(`Bad status from gateway ${res.status}`);
    });
  });
};
