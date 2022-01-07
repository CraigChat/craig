const defaults = require('tailwindcss/defaultConfig');
const sans = defaults.theme.fontFamily.sans;

module.exports = {
  purge: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bluish-gray': '#1e3a46',
        'bluish-gray-2': '#6b90a1'
      },
      width: {
        fit: 'fit-content'
      },
      minWidth: {
        '1/2': '50%',
        '2/5': '40%'
      }
    },
    fontFamily: {
      display: ['"Red Hat Display"', '"Red Hat Text"', ...sans],
      body: ['"Red Hat Text"', ...sans]
    }
  },
  variants: {},
  plugins: []
};
