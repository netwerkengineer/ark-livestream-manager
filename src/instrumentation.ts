export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initMidiBridge } = await import('./lib/midiBridge');
    initMidiBridge();
  }
}
