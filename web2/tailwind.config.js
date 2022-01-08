const defaults = require('tailwindcss/defaultConfig');
const sans = defaults.theme.fontFamily.sans;

module.exports = {
  purge: ['./page/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      width: {
        fit: 'fit-content'
      },
      minWidth: {
        '1/2': '50%',
        '2/5': '40%'
      }
    },
    fontFamily: {
      display: ['Lexend', '"Red Hat Text"', ...sans],
      body: ['"Red Hat Text"', ...sans]
    }
  },
  variants: {},
  plugins: []
};
