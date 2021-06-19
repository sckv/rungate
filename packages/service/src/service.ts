import fetch from 'node-fetch';

import fs from 'fs';

export const announceMySchema = async (opts: any) => {
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

  const hash = process.env.SERVICE_HASH || getRev();
  const name = process.env.SERVICE_NAME;
  const url = process.env.SERVICE_URL;
  const gateway = process.env.SERVICE_GATEWAY;
  const gatewayUrl = process.env.SERVICE_GATEWAY_URL;

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
