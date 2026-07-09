/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Notifier, NotifyEvent } from "../../interfaces/notifier";

/** ConsoleNotifier — the default. Prints a one-line structured event. Swap in your own channel. */
export class ConsoleNotifier implements Notifier {
  constructor(private readonly enabled = true) {}
  async send(event: NotifyEvent): Promise<void> {
    if (!this.enabled) return;
    const tx = event.txHash ? ` tx=${event.txHash}` : "";
    // eslint-disable-next-line no-console
    console.log(`[corine:${event.level}] ${event.title}${event.body ? ` — ${event.body}` : ""}${tx}`);
  }
}

/** A notifier that drops everything (tests / quiet mode). */
export class SilentNotifier implements Notifier {
  async send(): Promise<void> {}
}
