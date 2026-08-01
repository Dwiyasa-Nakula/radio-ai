interface RotationState {
  signature: string;
  remaining: string[];
  lastPicked?: string;
}

function shuffled(values: string[], random: () => number): string[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/**
 * In-memory shuffle bags keep station media varied without losing files.
 * Each key gets its own rotation and every file plays once before a refill.
 */
export class MediaRotation {
  private readonly states = new Map<string, RotationState>();

  pick(key: string, files: string[], random: () => number = Math.random): string | undefined {
    const available = [...new Set(files)].sort((left, right) => left.localeCompare(right));
    if (available.length === 0) {
      this.states.delete(key);
      return undefined;
    }

    const signature = available.join('\u0000');
    let state = this.states.get(key);
    if (!state || state.signature !== signature) {
      state = { signature, remaining: [], lastPicked: state?.lastPicked };
      this.states.set(key, state);
    }

    if (state.remaining.length === 0) {
      state.remaining = shuffled(available, random);
      if (
        state.remaining.length > 1 &&
        state.lastPicked &&
        state.remaining[0] === state.lastPicked
      ) {
        const swapIndex = state.remaining.findIndex((file) => file !== state?.lastPicked);
        [state.remaining[0], state.remaining[swapIndex]] = [
          state.remaining[swapIndex],
          state.remaining[0],
        ];
      }
    }

    const picked = state.remaining.shift();
    state.lastPicked = picked;
    return picked;
  }

  clear(): void {
    this.states.clear();
  }
}
