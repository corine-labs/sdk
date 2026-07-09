/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RugChecker } from "../../interfaces/data";
import type { RugAssessment } from "../../types";

/**
 * NoopRugChecker — the default. Returns a max (safe) score so the rug gate never
 * blocks unless you plug in a real assessor. This is honest: with no on-chain
 * heuristics wired, the SDK does not PRETEND to judge token safety. Implement
 * `RugChecker` with liquidity / mint-authority / holder-concentration checks (or
 * a provider) to make the optional rug gate meaningful.
 */
export class NoopRugChecker implements RugChecker {
  async checkToken(): Promise<RugAssessment> {
    return { score: 100, flags: [] };
  }
}
