let id = 1;

export const animate = async (add: string, remove: string, tooltip: HTMLElement | null): Promise<void> => {
  return new Promise((resolve) => {
    tooltip?.classList.add(add);
    tooltip?.classList.remove(remove);

    tooltip?.addEventListener('animationend', () => {
      tooltip?.classList.remove(add);
      resolve();
    });
  });
};

export const wait = (time: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

export const ID = () => id++;
