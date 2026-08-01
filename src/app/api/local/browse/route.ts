// src/app/api/local/browse/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { localFilesystemApiEnabled } from '@/app/lib/localFilesystemGuard';

export async function GET(request: NextRequest) {
  if (!localFilesystemApiEnabled()) {
    return NextResponse.json({ error: 'Local filesystem APIs are disabled in production' }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get('path');

  try {
    // If no path is specified, list Windows drive letters
    if (!targetPath) {
      const drives: string[] = [];
      const driveLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (const char of driveLetters) {
        const drive = `${char}:\\`;
        try {
          if (fs.existsSync(drive)) {
            drives.push(drive);
          }
        } catch {
          // Skip inaccessible drives
        }
      }
      return NextResponse.json({ path: '', parent: null, subdirs: drives.map(d => ({ name: d, path: d })) });
    }

    // Otherwise, verify and list subdirectories
    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json({ error: 'Folder does not exist' }, { status: 404 });
    }

    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a folder' }, { status: 400 });
    }

    const items = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    const subdirs = items
      .filter(item => {
        try {
          return item.isDirectory() && !item.name.startsWith('$') && !item.name.startsWith('.');
        } catch {
          return false;
        }
      })
      .map(item => ({
        name: item.name,
        path: path.join(resolvedPath, item.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(resolvedPath);
    // On Windows, if path.dirname('D:\') is 'D:\', parent should be null to list drives
    const hasParent = parentPath !== resolvedPath && resolvedPath.length > 3;

    return NextResponse.json({
      path: resolvedPath,
      parent: hasParent ? parentPath : null,
      subdirs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
