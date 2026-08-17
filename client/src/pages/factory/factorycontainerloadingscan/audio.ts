function createAudioContext(): AudioContext {
  const W = (window as unknown as Window & typeof globalThis & { webkitAudioContext: typeof AudioContext })
    .webkitAudioContext;
  return new (window.AudioContext || W)();
}
export function playFactoryLoadingSuccessTone(): void {
  try {
    const c = createAudioContext(),
      o = c.createOscillator();
    o.connect(c.destination);
    o.frequency.value = 1000;
    void c.resume().then(() => {
      o.start();
      setTimeout(() => {
        o.stop();
        void c.close();
      }, 120);
    });
  } catch {
    /* optional */
  }
}
