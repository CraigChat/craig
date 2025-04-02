import type { Middleware, Placement } from '@floating-ui/dom';

export type Timeout = ReturnType<typeof setTimeout> | undefined;

export interface Props {
  /** Allow HTML strings in the tooltip. */
  html: boolean;

  /**
   * The HTML element to place the tooltip.
   *
   * Default = `body`
   */
  target: string | HTMLElement;

  /**
   * The placement of the tooltip.
   *
   * Default = `top`
   */
  placement: Placement;

  /**
   * Padding for the `shift` middleware.
   *
   * Default = `0`
   */
  shiftPadding: number;

  /**
   * Offset of the tooltip.
   *
   * Default = `10`
   */
  offset: number;

  /** Conditionally show the tooltip. */
  visibility: boolean;

  /**
   * Delay for showing and hiding the tooltip.\
   * A `number` will apply on both in and out delays.\
   * A `array` will apply on in and out delays separately.
   */
  delay: number | [number, number];

  /** Always display the tooltip. */
  constant: boolean | [boolean, boolean];

  /** Classes used for the tooltip, arrow, entering/leaving classes. */
  classes: {
    /** The tooltip itself. */
    container: string;
    /** The content of the tooltip. */
    content: string;
    /** The arrow of the tooltip. */
    arrow: string;
    /** The class to be applied when the tooltip is entering. */
    animationEnter: string;
    /** The class to be applied when the tooltip is leaving. */
    animationLeave: string;
  };
  /**
   * Floating UI middleware.
   *
   * `flip`, `shift`, `offset`, and `arrow` are already included.
   */
  middleware: Middleware[];

  /** Hook function that fires when the tooltip has been mounted to the DOM. */
  onMount: () => void;

  /** Hook function that fires when the tooltip has been removed to the DOM. */
  onDestroy: () => void;
}

export interface Options extends Partial<Props> {
  /** The text content of the tooltip. */
  content?: any;
}
