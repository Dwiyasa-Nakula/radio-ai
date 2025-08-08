// file: src/lib/apiUtils.ts
async function withExponentialBackoff<T>(
  apiCall: () => Promise<T>,
  maxRetries: number = 5
): Promise<T> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await apiCall();
    } catch (error: any) {
      attempt++;
      if (attempt >= maxRetries || !error.code.includes) {
        throw error; // Non-retryable error or max retries reached
      }
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
      console.log(`Attempt ${attempt} failed. Retrying in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('API call failed after maximum retries.');
}