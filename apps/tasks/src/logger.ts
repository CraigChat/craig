import winston, { format } from 'winston';
import dayjs from 'dayjs';
import chalk, { Chalk } from 'chalk';
import * as util from 'util';
import config from 'config';

const levelColors: { [level: string]: Chalk } = {
  info: chalk.black.bgCyan,
  warn: chalk.black.bgYellow,
  error: chalk.black.bgRed,
  debug: chalk.magenta.bgBlack
};

const colorPool: Chalk[] = [
  chalk.black.bgCyan,
  chalk.black.bgYellow,
  chalk.black.bgRed,
  chalk.black.bgGreen,
  chalk.black.bgBlue,
  chalk.black.bgMagenta,
  chalk.black.bgGrey,
  chalk.black.bgCyanBright,
  chalk.black.bgYellowBright,
  chalk.black.bgRedBright,
  chalk.black.bgGreenBright,
  chalk.black.bgBlueBright,
  chalk.black.bgMagentaBright,
  chalk.cyan.bgBlack,
  chalk.yellow.bgBlack,
  chalk.red.bgBlack,
  chalk.green.bgBlack,
  chalk.blue.bgBlack,
  chalk.magenta.bgBlack,
  chalk.grey.bgBlack,
  chalk.cyanBright.bgBlack,
  chalk.yellowBright.bgBlack,
  chalk.redBright.bgBlack,
  chalk.greenBright.bgBlack,
  chalk.blueBright.bgBlack,
  chalk.magentaBright.bgBlack
];

function _centrePad(text: string, length: number) {
  if (text.length < length)
    return (
      ' '.repeat(Math.floor((length - text.length) / 2)) + text + ' '.repeat(Math.ceil((length - text.length) / 2))
    );
  else return text;
}

function _hashCode(str: string) {
  var hash = 0,
    i,
    chr;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}

function _log({ file, level, args }: { file: string; level: string; args: any[] }) {
  if (!winston.loggers.has(file))
    winston.loggers.add(file, {
      format: format.combine(
        format.printf((info) => {
          const lClk = levelColors[info.level] || chalk.yellow.bgBlack;
          const mClk = colorPool[Math.abs(_hashCode(file)) % colorPool.length];
          return (
            mClk(` ${file} `) +
            chalk.black.bgWhite(` ${dayjs().format('MM/DD HH:mm:ss')} `) +
            lClk(_centrePad(info.level, 10)) +
            ` ${info.message}`
          );
        })
      ),
      transports: [
        new winston.transports.Console({
          level: config.get('loggerLevel') || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
        })
      ]
    });

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

  winston.loggers.get(file).log(level, text.join(' '));
}

export interface Logger {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  log: (...args: any[]) => void;
}

export function createLogger(file: string): Logger {
  return {
    info: (...args: any[]) => _log({ file, level: 'info', args }),
    warn: (...args: any[]) => _log({ file, level: 'warn', args }),
    error: (...args: any[]) => _log({ file, level: 'error', args }),
    debug: (...args: any[]) => _log({ file, level: 'debug', args }),
    log: (...args: any[]) => _log({ file, level: 'debug', args })
  };
}
