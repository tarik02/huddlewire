import { inspect } from 'node:util';

export default function formatError(error: unknown) {
  return inspect(error, { colors: false, depth: 3 });
}
