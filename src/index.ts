import { RunGate } from './rungate';

const app = new RunGate();

const startStitched = async () => {
  await app.createRemoteExecutor('test', 'http://localhost:3000/graphql');

  await app.start(() => {
    console.log('Rungate started');
  });
};

startStitched().catch((e) => console.log(e));
