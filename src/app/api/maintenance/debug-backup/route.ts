import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAuthorized } from '@/lib/authHelper';
import { getSettings } from '@/lib/settingsStore';

export async function GET(req: NextRequest) {
  const settings = getSettings() as any;
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  
  let authorized = false;
  if (secret) {
    if (secret === settings.adminPin || secret === settings.nextAuthSecret) {
      authorized = true;
    }
  } else {
    const authSession = await isAuthorized(req, "admin");
    if (authSession) authorized = true;
  }
  
  if (!authorized) {
    return NextResponse.json({ error: "Niet geautoriseerd" }, { status: 401 });
  }


  const freeshowPath = settings.freeshowPath || '';
  const freeshowMediaPath = settings.freeshowMediaPath || '';
  const fallbackMediaPath = path.join(freeshowPath, 'media');
  const resolvedMediaPath = freeshowMediaPath || fallbackMediaPath;

  const results: any = {
    settings: {
      freeshowPath,
      freeshowMediaPath,
      freeshowProjectPath: settings.freeshowProjectPath || '',
    },
    resolvedMediaPath,
    fallbackMediaPath,
    checks: {},
  };

  // Check FreeShow root
  try {
    const stat = await fs.stat(freeshowPath);
    results.checks.freeshowRoot = { exists: true, isDir: stat.isDirectory() };
  } catch (e: any) {
    results.checks.freeshowRoot = { exists: false, error: e.message };
  }

  // List FreeShow root contents
  try {
    const items = await fs.readdir(freeshowPath);
    results.checks.freeshowContents = items;
  } catch (e: any) {
    results.checks.freeshowContents = { error: e.message };
  }

  // Check media with resolved path
  try {
    const stat = await fs.stat(resolvedMediaPath);
    results.checks.mediaResolved = { exists: true, isDir: stat.isDirectory(), path: resolvedMediaPath };
  } catch (e: any) {
    results.checks.mediaResolved = { exists: false, error: e.message, path: resolvedMediaPath };
  }

  // Check media with uppercase Media
  try {
    const uppercasePath = path.join(freeshowPath, 'Media');
    const stat = await fs.stat(uppercasePath);
    results.checks.mediaUppercase = { exists: true, isDir: stat.isDirectory(), path: uppercasePath };
  } catch (e: any) {
    results.checks.mediaUppercase = { exists: false, error: e.message, path: path.join(freeshowPath, 'Media') };
  }

  // Check media with lowercase media
  try {
    const lowercasePath = path.join(freeshowPath, 'media');
    const stat = await fs.stat(lowercasePath);
    results.checks.mediaLowercase = { exists: true, isDir: stat.isDirectory(), path: lowercasePath };
  } catch (e: any) {
    results.checks.mediaLowercase = { exists: false, error: e.message, path: path.join(freeshowPath, 'media') };
  }

  // If media exists, list its contents (first 20 items)
  try {
    const items = await fs.readdir(resolvedMediaPath);
    results.checks.mediaContents = { count: items.length, first20: items.slice(0, 20) };
  } catch (e: any) {
    results.checks.mediaContents = { error: e.message };
  }

  // Test symlink creation
  const testSymlinkPath = path.join(process.cwd(), 'data', `test_symlink_${Date.now()}`);
  try {
    await fs.symlink(resolvedMediaPath, testSymlinkPath);
    const stat = await fs.stat(testSymlinkPath); // follows symlink
    results.checks.symlinkTest = { success: true, targetIsDir: stat.isDirectory() };
    // Try to read through symlink
    try {
      const items = await fs.readdir(testSymlinkPath);
      results.checks.symlinkReaddir = { success: true, count: items.length };
    } catch (e: any) {
      results.checks.symlinkReaddir = { success: false, error: e.message };
    }
    await fs.unlink(testSymlinkPath).catch(() => {});
  } catch (e: any) {
    results.checks.symlinkTest = { success: false, error: e.message };
    await fs.unlink(testSymlinkPath).catch(() => {});
  }

  return NextResponse.json(results, { status: 200 });
}
