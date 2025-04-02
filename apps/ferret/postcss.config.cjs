const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');
const tailwindcssNesting = require('tailwindcss/nesting');
const postcssInport = require('postcss-import');

const config = {
  plugins: [
    postcssInport,
    tailwindcssNesting,
    // Some plugins, like tailwindcss/nesting, need to run before Tailwind,
    tailwindcss(),
    // But others, like autoprefixer, need to run after,
    autoprefixer
  ]
};

module.exports = config;
