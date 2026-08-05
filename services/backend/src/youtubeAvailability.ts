export type YouTubeCircuitState = {
  available: boolean;
  failures: number;
  retryAfterSeconds: number;
};

export class YouTubeCircuitOpenError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('YouTube extraction is temporarily paused');
    this.name = 'YouTubeCircuitOpenError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class YouTubeCircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  assertAvailable(): void {
    const state = this.state();
    if (!state.available) throw new YouTubeCircuitOpenError(state.retryAfterSeconds);
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordChallenge(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = this.now() + this.cooldownMs;
    }
  }

  state(): YouTubeCircuitState {
    const remainingMs = this.openUntil - this.now();
    if (remainingMs <= 0) {
      if (this.openUntil > 0) {
        this.failures = 0;
        this.openUntil = 0;
      }
      return { available: true, failures: this.failures, retryAfterSeconds: 0 };
    }
    return {
      available: false,
      failures: this.failures,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }
}
