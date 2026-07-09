/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface NotifyEvent {
  level: "info" | "success" | "warn" | "error";
  title: string;
  body?: string;
  txHash?: string;
  /** Stable key to de-duplicate repeated deliveries of the same event. */
  dedupeKey?: string;
}

/**
 * Notifier — where the runtime reports what it did. Default: `ConsoleNotifier`.
 * Implement this to fan out to Telegram/Discord/webhooks with YOUR own token —
 * no notification credential is embedded in the SDK.
 */
export interface Notifier {
  send(event: NotifyEvent): Promise<void>;
}
