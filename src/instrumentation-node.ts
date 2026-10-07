// Node.js-runtime startup gate (imported only when NEXT_RUNTIME === 'nodejs'): refuse to boot unless SANDBOX.
import { bootCheck } from './server/boot';

const r = bootCheck(process.env);
if (!r.ok) {
  console.error(`BOOT REFUSED: ${r.message}`);
  process.exit(1);
}
