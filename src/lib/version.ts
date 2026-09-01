import pkg from '../../package.json';
// Written by deploy_proxmox.sh / deploy_nas.py right before packaging (real
// git working tree isn't itself shipped - .git is excluded from the tar),
// then restored to this placeholder afterward so the repo stays clean.
// Committing a placeholder means local dev / a fresh clone still builds
// fine before any deploy has ever run.
import gitSha from './gitSha.generated.json';

export const VERSION = pkg.version;
export const GIT_SHA = gitSha.sha;
