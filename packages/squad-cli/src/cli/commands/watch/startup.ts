import path from 'node:path';
import { resolveSquad as resolveRegistrySquad } from '@bradygaster/squad-sdk';

import { detectSquadDir } from '../../core/detect-squad-dir.js';
import type { WatchConfig } from './config.js';

function squadDirInfoFromPath(squadPath: string): ReturnType<typeof detectSquadDir> {
  const name = path.basename(squadPath) === '.ai-team' ? '.ai-team' : '.squad';
  return { path: squadPath, name, isLegacy: name === '.ai-team' };
}

export function resolveWatchStartupSquadDir(dest: string, config: WatchConfig): ReturnType<typeof detectSquadDir> {
  const contextPath = config.stateContext?.resolution.path;
  if (contextPath) {
    return squadDirInfoFromPath(contextPath);
  }

  const resolved = resolveRegistrySquad({
    cwd: dest,
    env: process.env,
    registryPath: process.env['SQUAD_REGISTRY_PATH'],
  });
  if (resolved) {
    return squadDirInfoFromPath(resolved.path);
  }

  return detectSquadDir(dest);
}
