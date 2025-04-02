import * as util from 'node:util';

import chalk, { Chalk } from 'chalk';
import dayjs from 'dayjs';
import winston, { format } from 'winston';

interface LoggerOptions {
  level?: string;
  time?: boolean;
  winston?: winston.LoggerOptions;
}

export class Logger {
  #levelColors: { [level: string]: Chalk } = {
    info: chalk.black.bgCyan,
    warn: chalk.black.bgYellow,
    error: chalk.black.bgRed,
    debug: chalk.magenta.bgBlack
  };

  #colorPool: Chalk[] = [
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

  #chalkedName?: string;
  #winston: winston.Logger;

  constructor(name?: string, opts?: LoggerOptions) {
    if (name) this.#chalkedName = this.#randomChalk(name)(` ${name} `);

    this.#winston = new winston.Logger({
      format:
        opts?.winston?.format ||
        format.combine(
          format.printf((info) => {
            const chalkedLevel = this.#levelColors[info.level] || chalk.yellow.bgBlack;
            return (
              (this.#chalkedName || '') +
              (opts?.time || opts?.time !== false ? chalk.black.bgWhite(` ${dayjs().format('MM/DD HH:mm:ss')} `) : '') +
              chalkedLevel(this.#centerPad(info.level, 10)) +
              ` ${info.message}`
            );
          })
        ),
      transports: opts?.winston?.transports || [
        new winston.transports.Console({
          level: opts?.level || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
        })
      ]
    });
  }

  #randomChalk(text: string) {
    return this.#colorPool[Math.abs(this.#hashCode(text)) % this.#colorPool.length];
  }

  #centerPad(text: string, length: number) {
    if (text.length < length) return ' '.repeat(Math.floor((length - text.length) / 2)) + text + ' '.repeat(Math.ceil((length - text.length) / 2));
    else return text;
  }

  #hashCode(str: string) {
    let hash = 0,
      i,
      chr;
    for (i = 0; i < str.length; i++) {
      chr = str.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      hash |= 0;
    }
    return hash;
  }

  #log(level: string, args: any[]) {
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
        text.push(util.inspect(arg));
      } else text.push(arg);
    }

    this.#winston.log(level, text.join(' '));
  }

  info(...args: any[]) {
    return this.#log('info', args);
  }

  warn(...args: any[]) {
    return this.#log('warn', args);
  }

  error(...args: any[]) {
    return this.#log('error', args);
  }

  debug(...args: any[]) {
    return this.#log('debug', args);
  }

  log(...args: any[]) {
    return this.#log('debug', args);
  }
}
