/** pretty-ms + translation */
import parseMilliseconds from 'parse-ms';
import { TFunction } from 'react-i18next';

const pluralize = (word: string, count: number) => (count === 1 ? word : `${word}s`);

const SECOND_ROUNDING_EPSILON = 0.0000001;

export default function prettyMilliseconds(milliseconds: number, options: Options = {}) {
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Expected a finite number');
  }

  if (options.colonNotation) {
    options.compact = false;
    options.formatSubMilliseconds = false;
    options.separateMilliseconds = false;
    options.verbose = false;
  }

  if (options.compact) {
    options.secondsDecimalDigits = 0;
    options.millisecondsDecimalDigits = 0;
  }

  const result: string[] = [];

  const floorDecimals = (value: number, decimalDigits: number) => {
    const flooredInterimValue = Math.floor(value * 10 ** decimalDigits + SECOND_ROUNDING_EPSILON);
    const flooredValue = Math.round(flooredInterimValue) / 10 ** decimalDigits;
    return flooredValue.toFixed(decimalDigits);
  };

  const add = (value: number, long: string, short: string, valueString?: string) => {
    if ((result.length === 0 || !options.colonNotation) && value === 0 && !(options.colonNotation && short === 'm')) {
      return;
    }

    valueString = (valueString || value || '0').toString();
    if (options.colonNotation) {
      const prefix = result.length > 0 ? ':' : '';
      const wholeDigits = valueString.includes('.') ? valueString.split('.')[0].length : valueString.length;
      const minLength = result.length > 0 ? 2 : 1;
      valueString = '0'.repeat(Math.max(0, minLength - wholeDigits)) + valueString;
      result.push(prefix + valueString);
    } else if (!options.verbose) {
      result.push(valueString + short);
    } else if (options.t) result.push(options.t(`ms.${short}`, { count: value }));
    else result.push(`${valueString} ${pluralize(long, value)}`);
  };

  const parsed = parseMilliseconds(milliseconds);

  add(Math.trunc(parsed.days / 365), 'year', 'y');
  add(parsed.days % 365, 'day', 'd');
  add(parsed.hours, 'hour', 'h');
  add(parsed.minutes, 'minute', 'm');

  if (
    options.separateMilliseconds ||
    options.formatSubMilliseconds ||
    (!options.colonNotation && milliseconds < 1000)
  ) {
    add(parsed.seconds, 'second', 's');
    if (options.formatSubMilliseconds) {
      add(parsed.milliseconds, 'millisecond', 'ms');
      add(parsed.microseconds, 'microsecond', 'µs');
      add(parsed.nanoseconds, 'nanosecond', 'ns');
    } else {
      const millisecondsAndBelow = parsed.milliseconds + parsed.microseconds / 1000 + parsed.nanoseconds / 1e6;

      const millisecondsDecimalDigits =
        typeof options.millisecondsDecimalDigits === 'number' ? options.millisecondsDecimalDigits : 0;

      const roundedMiliseconds =
        millisecondsAndBelow >= 1 ? Math.round(millisecondsAndBelow) : Math.ceil(millisecondsAndBelow);

      const millisecondsString = millisecondsDecimalDigits
        ? millisecondsAndBelow.toFixed(millisecondsDecimalDigits)
        : String(roundedMiliseconds);

      add(Number.parseFloat(millisecondsString), 'millisecond', 'ms', millisecondsString);
    }
  } else {
    const seconds = (milliseconds / 1000) % 60;
    const secondsDecimalDigits = typeof options.secondsDecimalDigits === 'number' ? options.secondsDecimalDigits : 1;
    const secondsFixed = floorDecimals(seconds, secondsDecimalDigits);
    const secondsString = options.keepDecimalsOnWholeSeconds ? secondsFixed : secondsFixed.replace(/\.0+$/, '');
    add(Number.parseFloat(secondsString), 'second', 's', secondsString);
  }

  if (result.length === 0)
    return options.verbose && options.t
      ? options.t('ms.ms', { count: 0 })
      : `0${options.verbose ? ' milliseconds' : 'ms'}`;

  if (options.compact) return result[0].trim();

  if (typeof options.unitCount === 'number') {
    const separator = options.colonNotation ? '' : ' ';
    return result.slice(0, Math.max(options.unitCount, 1)).join(separator);
  }

  return options.colonNotation ? result.join('') : result.join(' ');
}

interface Options {
  t?: TFunction;

  /**
  Number of digits to appear after the seconds decimal point.

  @default 1
  */
  secondsDecimalDigits?: number;

  /**
  Number of digits to appear after the milliseconds decimal point.

  Useful in combination with [`process.hrtime()`](https://nodejs.org/api/process.html#process_process_hrtime).

  @default 0
  */
  millisecondsDecimalDigits?: number;

  /**
  Keep milliseconds on whole seconds: `13s` → `13.0s`.

  Useful when you are showing a number of seconds spent on an operation and don't want the width of the output to change when hitting a whole number.

  @default false
  */
  keepDecimalsOnWholeSeconds?: boolean;

  /**
  Only show the first unit: `1h 10m` → `1h`.

  Also ensures that `millisecondsDecimalDigits` and `secondsDecimalDigits` are both set to `0`.

  @default false
  */
  compact?: boolean;

  /**
  Number of units to show. Setting `compact` to `true` overrides this option.

  @default Infinity
  */
  unitCount?: number;

  /**
  Use full-length units: `5h 1m 45s` → `5 hours 1 minute 45 seconds`.

  @default false
  */
  verbose?: boolean;

  /**
  Show milliseconds separately. This means they won't be included in the decimal part of the seconds.

  @default false
  */
  separateMilliseconds?: boolean;

  /**
  Show microseconds and nanoseconds.

  @default false
  */
  formatSubMilliseconds?: boolean;

  /**
  Display time using colon notation: `5h 1m 45s` → `5:01:45`. Always shows time in at least minutes: `1s` → `0:01`

  Useful when you want to display time without the time units, similar to a digital watch.

  Setting `colonNotation` to `true` overrides the following options to `false`:
  - `compact`
  - `formatSubMilliseconds`
  - `separateMilliseconds`
  - `verbose`

  @default false
  */
  colonNotation?: boolean;
}
