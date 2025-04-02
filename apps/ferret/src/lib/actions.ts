export function clickOutside(node: HTMLElement, { ignore }: { ignore?: HTMLElement } = {}) {
  const handleClick = (event: MouseEvent) => {
    if (!node.contains(event.target as unknown as Node) && (!ignore || !ignore.contains(event.target as unknown as Node))) {
      node.dispatchEvent(new CustomEvent('blur'));
    }
  };

  document.addEventListener('click', handleClick);

  return {
    destroy() {
      document.removeEventListener('click', handleClick);
    }
  };
}

export function fallbackImage(node: HTMLImageElement, { to }: { to: string }) {
  const handleError = () => {
    node.src = to;
  };

  node.addEventListener('error', handleError);

  return {
    destroy() {
      node.removeEventListener('error', handleError);
    }
  };
}
