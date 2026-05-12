import { theme as _theme } from 'tailwindcss/defaultConfig';
const sans = _theme.fontFamily.sans;
const mono = _theme.fontFamily.mono;

export const content = ['./page/src/**/*.{js,jsx,ts,tsx}'];
export const theme = {
  extend: {
    minWidth: {
      '1/2': '50%',
      '2/5': '40%',
      button: '80px',
      'button-sm': '60px'
    },
    width: {
      18: '4.5rem'
    },
    height: {
      18: '4.5rem'
    }
  },
  fontFamily: {
    display: ['Lexend', '"Red Hat Text"', ...sans],
    body: ['"Red Hat Text"', ...sans],
    mono: ['"Ubuntu Mono"', ...mono]
  }
};
export const variants = {};
export const plugins = [];
