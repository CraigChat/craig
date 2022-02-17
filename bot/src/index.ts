import path from 'path';

// Config fix for running in devscript
if (path.parse(process.cwd()).name === 'dist') process.env.NODE_CONFIG_DIR = path.join(process.cwd(), '..', 'config');

import { connect } from './bot';

connect();
