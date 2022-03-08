import winston, { format } from 'winston';
import dayjs from 'dayjs';
import chalk, { Chalk } from 'chalk';
import * as util from 'util';

const logger = winston.createLogger({
  format: format.combine(
    format.printf((info) => {
      const lClk = levelColors[info.level] || chalk.yellow.bgBlack;
      return (
        chalk.black.bgBlueBright(` shard master `) +
        chalk.black.bgWhite(` ${dayjs().format('MM/DD HH:mm:ss')} `) +
        lClk(_centrePad(info.level, 10)) +
        ` ${info.message}`
      );
    })
  ),
  transports: [
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
    })
  ]
});

const levelColors: { [level: string]: Chalk } = {
  info: chalk.black.bgCyan,
  warn: chalk.black.bgYellow,
  error: chalk.black.bgRed,
  debug: chalk.magenta.bgBlack
};

function _centrePad(text: string, length: number) {
  if (text.length < length)
    return (
      ' '.repeat(Math.floor((length - text.length) / 2)) + text + ' '.repeat(Math.ceil((length - text.length) / 2))
    );
  else return text;
}

function _log(level: string, args: any[]) {
  const text = [];

  // Util formatting
  if (typeof args[0] === 'string') {
    const formats = args[0].match(/%[sdifjoO]/g);
    if (formats) {
      const a = args.splice(1, formats.length);
      text.push(util.format(args.shift(), ...a));
    } else text.push(chalk.white(args.shift()));
  }

  // Colorize the rest of the arguments
  for (const arg of args) {
    if (typeof arg === 'string') {
      text.push(chalk.magenta(`'${arg}'`));
    } else if (typeof arg === 'number') {
      text.push(chalk.cyan(arg.toString()));
    } else if (typeof arg === 'object') {
      text.push('\n');

      if (arg instanceof Error) {
        text.push(chalk.red(arg.stack));
      } else {
        text.push(util.inspect(arg));
      }
    } else text.push(arg);
  }

  logger.log(level as any, text.join(' '));
}

export function debug(...args: any[]) {
  return _log('debug', args);
}

export function log(...args: any[]) {
  return _log('debug', args);
}

export function info(...args: any[]) {
  return _log('info', args);
}

export function warn(...args: any[]) {
  return _log('warn', args);
}

export function error(...args: any[]) {
  return _log('error', args);
}
