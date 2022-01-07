import { h } from 'preact';
import { render } from 'preact/compat';

import 'tailwindcss/tailwind.css';
import 'react-tippy/dist/tippy.css';
import '@fontsource/red-hat-text/400.css';
import './index.sass';
import App from './components/app';

document.addEventListener('DOMContentLoaded', () => {
  render(<App />, document.querySelector('#preact_root')!);
});
