
export type AsyncThunk<ReturnType = void> = () => Promise<ReturnType>;

export interface BackoffPolicy {
 	getDelay(): number;
}

export class LinearBackoffPolicy implements BackoffPolicy {
	numAttempts: number = 0;
	delay: number;
	increment: number;
	constructor(delay: number, increment?: number) {
		this.delay = delay;
		if (!increment) {
			this.increment = delay;
		}
	 }
	 getDelay(): number {
		this.numAttempts++;
		return this.numAttempts*this.delay;
	}
}

export class ExponentialBackoffPolicy implements BackoffPolicy {
	numAttempts: number = 0;
	delay: number;
	delayBase: number;
	exponential: number;
	constructor(delayBase: number, exponential: number) {
		this.delayBase = delayBase;
		this.exponential = exponential;
	 }
	 getDelay(): number {
		this.numAttempts++;
		return Math.pow(this.delayBase, this.exponential);
	}
}

export interface RetryOptions {
	maxAttempts?: number,
	/**
	 * Abort the operation if the total time spent exceeds this 
	 * time
	 */
	retryTotalTimeMs?: number,
	/**
	 * The minimum and maximum delay between retry attempts which
	 * grows according to the backoff policy and its parameters
	 */
	delayMs?: {min?: number, max?: number},
	
	delayIncreaseMs?: number,
	/**
	 * Jitter is a random amount of time added to the delay
	 * to reduce the likelihood of multiple machines or actions
	 * on the same machine attempting their retries simultaneously.
	 */
	jitter?: {minJitterMs?: number, maxJitterMs?: number},
	retryableErrors?: [any],
	nonretryableErrors?: [any],
	canRetry?: (err)=>{retry: boolean, message?: string}
	backoffPolicy: BackoffPolicy
	/**
	 * The maximum amount of total time that will be spent 
	 * attempting the operation, before timing out.
	 */
	maximumTimeoutMs?: number,
}

async function retry<T>( thunk:AsyncThunk<T>, opts: RetryOptions ): Promise<T> {
	do {
		var numAttempts = 0;
		try {
			numAttempts++;
			return thunk();
		} catch (err) {
			if (opts.maxAttempts && numAttempts >= opts.maxAttempts) {
				throw new MaxAttemptsError(err?.message);
			}
			if (opts.retryableErrors) {
				for (var e in opts.retryableErrors) {
					if (opts.retryableErrors.includes(e) {
						continue;
					}
				}
			}
			if (opts.nonretryableErrors) {
				for (var e in opts.nonretryableErrors) {
					throw new NonretriableError(err?.message);
				}
			}
			if (opts.canRetry) {
				const retry = opts.canRetry(err);
				if (!retry.retry) {
					throw new NonretriableError(retry.message);
				}
			}


		}
	}
}

export class NonretriableError extends Error {
	constructor(public message: string, public code?: string) {
		super(code);
	}
}

export class MaxAttemptsError extends Error {
	constructor(public message: string, public code?: string) {
		super(code);
	}
}

retry<number>(foo, {maxAttempts: 3, backoffPolicy: new LinearBackoffPolicy(100)});

async function foo():Promise<number> { 
	return Promise.resolve(3);
}
export {};