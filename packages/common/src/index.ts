export interface TimeMarkOptions {
  includeHours?: boolean;
  secondsDecimalPlaces?: number;
  invalid?: string;
}

export function convertToTimemark(seconds: number, options: TimeMarkOptions | boolean = {}): string {
  const { includeHours = false, secondsDecimalPlaces, invalid = '00:00:00' } = typeof options === 'boolean' ? { includeHours: options } : options;
  if (isNaN(seconds) || seconds < 0) return invalid;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const formattedHours = hours < 10 ? `0${hours}` : `${hours}`;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const secondsText = secondsDecimalPlaces === undefined ? `${remainingSeconds}` : remainingSeconds.toFixed(secondsDecimalPlaces);
  const formattedSeconds = remainingSeconds < 10 ? `0${secondsText}` : secondsText;

  return `${hours === 0 && !includeHours ? '' : `${formattedHours}:`}${formattedMinutes}:${formattedSeconds}`;
}
