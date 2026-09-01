export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initMidiBridge } = await import('./lib/midiBridge');
    initMidiBridge();

    const { initThumbnailSync } = await import('./lib/thumbnailSync');
    initThumbnailSync();

    const { initEmailSync } = await import('./lib/email');
    initEmailSync();

    // Was previously only started as a side effect of loading
    // /api/obs/status's module, which only happens once someone opens the
    // Monitor tab - after any deploy/restart with nobody visiting it, the
    // LED sign's YouTube-live polling (and the OBS websocket connection)
    // never started at all, so the sign silently never updated.
    const { ensureOBSManager } = await import('./lib/obsManager');
    ensureOBSManager();
  }
}
