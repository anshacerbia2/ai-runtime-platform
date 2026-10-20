/** Test-only proc observation; never accepts an application PID or authorizes signals. */
export function parseProbeProcessStat(value) {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error('Invalid owned probe process.');
  }
  const prefix = /^([1-9][0-9]*) \(/.exec(value);
  const end = value.lastIndexOf(') ');
  if (!prefix || end < prefix[0].length) {
    throw new Error('Invalid owned probe process.');
  }
  const fields = value
    .slice(end + 2)
    .trimEnd()
    .split(' ');
  if (
    fields.length < 20 ||
    !/^[A-Za-z]$/.test(fields[0]) ||
    ![fields[1], fields[2], fields[19]].every((field) => /^[0-9]+$/.test(field))
  ) {
    throw new Error('Invalid owned probe process.');
  }
  const pid = Number(prefix[1]);
  const parent = Number(fields[1]);
  const group = Number(fields[2]);
  if (
    ![pid, parent, group].every(
      (number) =>
        Number.isSafeInteger(number) && number >= 0 && number <= 2147483647,
    )
  ) {
    throw new Error('Invalid owned probe process.');
  }
  return Object.freeze({
    pid,
    parent,
    group,
    state: fields[0],
    startTicks: fields[19],
  });
}
