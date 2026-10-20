import { posix } from 'node:path';
import { assertProbeHost } from './gvisor-profile.mjs';

/** Fixed privileged fixture invocation, never a production launcher. No I/O here. */
export function nativeCoordinatorInvocation(args, host) {
  assertProbeHost({
    ...host,
    disposable: args[0] === '--disposable-linux-host',
  });
  if (
    host.arch !== 'x64' ||
    args.length !== 3 ||
    !args
      .slice(1)
      .every(
        (path) =>
          typeof path === 'string' &&
          posix.isAbsolute(path) &&
          posix.resolve(path) === path &&
          !path.includes('\0'),
      )
  ) {
    throw new Error(
      'Native coordinator proof requires exactly the approved x64 fixture and absolute pinned binary paths.',
    );
  }
  return Object.freeze({ runsc: args[1], busybox: args[2] });
}
