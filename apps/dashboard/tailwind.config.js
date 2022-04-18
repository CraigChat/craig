const defaults = require('tailwindcss/defaultConfig');
const sans = defaults.theme.fontFamily.sans;
const mono = defaults.theme.fontFamily.mono;

module.exports = {
  content: ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Lexend', '"Red Hat Text"', ...sans],
        body: ['"Red Hat Text"', ...sans],
        roboto: ['Roboto', ...sans],
        mono: ['"Ubunto Mono"', ...mono]
      }
    }
  },
  plugins: []
};
