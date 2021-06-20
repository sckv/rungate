import { RunGate } from './rungate';

const app = new RunGate();

app
  .start((address) => {
    console.log(`Rungate started at ${address}`);
  })
  .catch((e) => console.log(e));
