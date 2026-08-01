export function localFilesystemApiEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOCAL_FILESYSTEM_API === 'true';
}

export function legacyBackendApiEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOCAL_BACKEND_API === 'true';
}
