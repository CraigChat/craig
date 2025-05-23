import chalk, { Chalk } from 'chalk';
import dayjs from 'dayjs';
import { BaseConfig, DexareClient, DexareModule, LoggerExtra } from 'dexare';
import * as util from 'node:util';
import winston, { format } from 'winston';

export interface LoggerConfig extends BaseConfig {
  logger?: LoggerModuleOptions;
}

export interface LoggerModuleOptions {
  level?: string;
  inspectOptions?: any;
}

const colorPool = [
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

export default class LoggerModule<T extends DexareClient<LoggerConfig>> extends DexareModule<T> {
  moduleColors: { [level: string]: Chalk } = {
    dexare: chalk.black.bgRed,
    eris: chalk.black.bgCyan,
    recorder: chalk.red.bgBlack,
    sharding: chalk.blue.bgBlack,
    autorecord: chalk.black.bgGreen,
    commands: chalk.black.bgYellow,
    sys: chalk.black.bgGray,
    dbots: chalk.black.bgYellowBright
  };

  levelColors: { [level: string]: Chalk } = {
    info: chalk.black.bgCyan,
    warn: chalk.black.bgYellow,
    error: chalk.black.bgRed,
    debug: chalk.magenta.bgBlack
  };

  constructor(client: T) {
    super(client, {
      name: 'logger',
      description: 'Colorful logging with the winston module'
    });

    this.client.logErisEvents();

    // Overwrite warn listener
    this.client.bot.removeAllListeners('warn').on('warn', (message, id) => {
        this.client.emit('logger', 'warn', 'eris', [message], { id });
    });

    this.filePath = __filename;
  }

  load() {
    this.registerEvent('logger', this.onLog.bind(this));
  }

  unload() {
    this.unregisterAllEvents();
  }

  get config() {
    return this.client.config.logger;
  }

  private async onLog(_: unknown, level: string, moduleName: string, args: any[], extra?: LoggerExtra) {
    if (!winston.loggers.has(moduleName))
      winston.loggers.add(moduleName, {
        format: format.combine(
          format.printf((info) => {
            const lClk = this.levelColors[info.level] || chalk.yellow.bgBlack;
            const mClk = this.moduleColors[moduleName] || colorPool[Math.abs(this._hashCode(moduleName)) % colorPool.length];
            return (
              (process.env.SHARD_ID ? chalk.white.bgBlue(` shard ${process.env.SHARD_ID} `) : '') +
              mClk(` ${moduleName} `) +
              chalk.black.bgWhite(` ${dayjs().format('MM/DD HH:mm:ss')} `) +
              lClk(this._centrePad(info.level, 10)) +
              ` ${info.message}`
            );
          })
        ),
        transports: [
          new winston.transports.Console({
            level: this.config?.level || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
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
          text.push(util.inspect(arg, this.config?.inspectOptions || {}));
        }
      } else text.push(arg);
    }

    winston.loggers.get(moduleName).log(level as any, text.join(' '), extra);
  }

  private _centrePad(text: string, length: number) {
    if (text.length < length) return ' '.repeat(Math.floor((length - text.length) / 2)) + text + ' '.repeat(Math.ceil((length - text.length) / 2));
    else return text;
  }

  private _hashCode(str: string) {
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
}
