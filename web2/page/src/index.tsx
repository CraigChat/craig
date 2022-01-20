import { h } from 'preact';
import { render } from 'preact/compat';

import 'tailwindcss/tailwind.css';
import 'react-tippy/dist/tippy.css';
import '@fontsource/red-hat-text/400.css';
import '@fontsource/red-hat-text/500.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/700.css';
import '@fontsource/ubuntu-mono/400.css';
import './index.sass';

import 'web-streams-polyfill';
import '@mattiasbuelens/web-streams-adapter'; // https://github.com/MattiasBuelens/web-streams-polyfill/issues/93#issuecomment-925329286
import 'streamsaver';
import './i18n';
import App from './components/app';

document.addEventListener('DOMContentLoaded', () => {
  render(<App />, document.querySelector('#preact_root')!);
});
