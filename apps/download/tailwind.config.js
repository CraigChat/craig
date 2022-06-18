const defaults = require('tailwindcss/defaultConfig');
const sans = defaults.theme.fontFamily.sans;
const mono = defaults.theme.fontFamily.mono;

module.exports = {
  content: ['./page/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
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
      mono: ['"Ubunto Mono"', ...mono]
    }
  },
  variants: {},
  plugins: []
};
