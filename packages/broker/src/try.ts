import { RunGateBroker } from './broker';

new RunGateBroker().start(() => {
  console.log('RunGate broker is listening');
});
