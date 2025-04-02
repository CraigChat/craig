import type { Props } from './types';

export const DEFAULTS: {
  html: Props['html'];
  target: Props['target'];
  placement: Props['placement'];
  shiftPadding: Props['shiftPadding'];
  offset: Props['offset'];
  delay: Props['delay'];
  constant: Props['constant'];
  classes: Props['classes'];
  middleware: Props['middleware'];
  visibility: Props['visibility'];
} = {
  html: false,
  target: 'body',
  placement: 'top',
  shiftPadding: 0,
  offset: 10,
  delay: 0,
  constant: false,
  visibility: true,
  classes: {
    container: 'svooltip',
    content: 'svooltip-content',
    arrow: 'svooltip-arrow',
    animationEnter: 'svooltip-entering',
    animationLeave: 'svooltip-leaving'
  },
  middleware: []
};
