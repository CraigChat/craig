export * from './crc32.js';
export * from './webappProtocol.js';

export interface TimeMarkOptions {
  includeHours?: boolean;
  secondsDecimalPlaces?: number;
  invalid?: string;
}

export function convertToTimemark(seconds: number, options: TimeMarkOptions | boolean = {}): string {
  const { includeHours = false, secondsDecimalPlaces, invalid = '00:00:00' } = typeof options === 'boolean' ? { includeHours: options } : options;
  if (!Number.isFinite(seconds) || seconds < 0) return invalid;

  const total = secondsDecimalPlaces === undefined ? seconds : Number(seconds.toFixed(secondsDecimalPlaces));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const secondsText = secondsDecimalPlaces === undefined ? `${remainingSeconds}` : remainingSeconds.toFixed(secondsDecimalPlaces);
  const formattedSeconds = Math.floor(remainingSeconds) < 10 ? `0${secondsText}` : secondsText;

  return `${hours === 0 && !includeHours ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}
