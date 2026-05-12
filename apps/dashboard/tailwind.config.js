import { theme as _theme } from 'tailwindcss/defaultConfig';
const sans = _theme.fontFamily.sans;
const mono = _theme.fontFamily.mono;

export const content = ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'];
export const theme = {
  extend: {
    fontFamily: {
      display: ['Lexend', '"Red Hat Text"', ...sans],
      body: ['"Red Hat Text"', ...sans],
      roboto: ['Roboto', ...sans],
      mono: ['"Ubunto Mono"', ...mono]
    }
  }
};
export const plugins = [];
