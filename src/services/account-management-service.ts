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

  disconnectSpotify() {
    return this.runLocked(() => this.store.disconnectSpotifyState());
  }

  disconnectYouTube() {
    return this.runLocked(() => this.store.disconnectYouTubeState());
  }

  resetAll() {
    return this.runLocked(() => this.store.resetAllProjectState());
  }

  private runLocked<T>(action: () => T) {
    const holder = randomUUID();
    const acquired = this.store.acquireLock(
      ACCOUNT_ACTION_LOCK_NAME,
      holder,
      this.config.syncLockTtlMs,
    );

    if (!acquired) {
      throw new AppError(
        "동기화 작업이 실행 중이라 지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        409,
      );
    }

    try {
      return action();
    } finally {
      this.store.releaseLock(ACCOUNT_ACTION_LOCK_NAME, holder);
    }
  }
}
