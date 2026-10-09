export class RateLimitError extends Error {
  readonly status = 429;
  constructor(message = "Too many attempts. Please wait a minute and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}
