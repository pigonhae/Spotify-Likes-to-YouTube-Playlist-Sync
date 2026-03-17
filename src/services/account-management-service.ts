import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config.js";
import type { AppStore } from "../db/store.js";
import { AppError } from "../lib/errors.js";

const ACCOUNT_ACTION_LOCK_NAME = "hourly-sync";

export interface AccountActionResult {
  alreadyDisconnected?: boolean;
  deletedAccounts?: number;
  deletedStates?: number;
  deletedPlaylistSetting?: number;
  deletedPlaylistVideos?: number;
  resetTrackBindings?: number;
  deletedSettings?: number;
  deletedTrackMappings?: number;
  deletedSyncRuns?: number;
}

export class AccountManagementService {
  constructor(
    private readonly config: AppConfig,
    private readonly store: AppStore,
  ) {}

  async disconnectSpotify() {
    return this.runLocked(() => this.store.disconnectSpotifyState());
  }

  async disconnectYouTube() {
    return this.runLocked(() => this.store.disconnectYouTubeState());
  }

  async resetAll() {
    return this.runLocked(() => this.store.resetAllProjectState());
  }

  private async runLocked<T>(action: () => Promise<T>) {
    const holder = randomUUID();
    const acquired = await this.store.acquireLock(
      ACCOUNT_ACTION_LOCK_NAME,
      holder,
      this.config.syncLockTtlMs,
    );

    if (!acquired) {
      throw new AppError(
        "Another sync or account operation is already running. Please wait and try again.",
        409,
      );
    }

    try {
      return await action();
    } finally {
      await this.store.releaseLock(ACCOUNT_ACTION_LOCK_NAME, holder);
    }
  }
}
