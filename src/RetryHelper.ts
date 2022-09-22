
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

const sleep: (ms?: number) => void = (ms?: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The configurable parameters for retrying the operation
 */
export interface RetryOptions {
	/**
	 * The backoff policy to use to determine the delay between 
	 * attempts when retrying.
	 */
	backoffPolicy: BackoffPolicy
	/**
	 * The maximum number of attempts before the operation will fail
	 * with MaxAttemptsException.
	 */
	maxAttempts?: number,
	/**
	 * The maximum amount of total time that will be spent 
	 * attempting the operation, before timing out.
	 */
	maximumTimeoutMs?: number,
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
	/**
	 * If a function is supplied, it solely determines whether 
	 * an error thrown by the service is eligible to be retried.
	 * This permits inspecting the error value directly to determine
	 * whether the operation can be retried.
	 * 
	 * This function takes precedence over `retryableErrors` if specified.
	 */
	canRetry?: (err)=>{retry: boolean, message: string}
	/**
	 * A list of error types that are retriable. If the function throws an
	 * exception on this list of types, it will be retried.
	 * 
	 * Any errors that are not on this list will be counted as 
	 * non-retriable failures and propagated.
	 */
	retryableErrors?: [any],
}

type RetryOption = (attempts: number, delayMs: number, err: any):number;

class RetryHelper {
	private retryOptions: RetryOption[];
	constructor(retryOptions?: RetryOption[]) {
		if (this.retryOptions) {
			this.retryOptions = retryOptions as RetryOption[];
		}
	}
	add(retryOption: RetryOption):this {
		this.retryOptions.push(retryOption);
		return this;
	}

	async retry<T>( thunk: AsyncThunk<T> ): Promise<T> {
		var numAttempts: number = 0;
		var delayMs: number = 0;
		while (true) {
			try {
				const val = await thunk();
			} catch (err) {
				for (const opt of this.retryOptions) {
					delayMs = opt(numAttempts, delayMs, err);
				}
				await sleep(delayMs);
			}
		}
	}

	addRetriableExceptionTypes<T>(exceptionTypes:T[]):this {
		this.retryOptions.push(this.add({attempts, delayMs, err} => {
			if (!exceptionTypes.includes(typeof err) {
				throw new NonretriableException("Nonretriable exception", err);
			}
		}
		return this;
	}

}


async function retry<T>( thunk:AsyncThunk<T>, opts: RetryOptions ): Promise<T> {
	do {
		const startTime = new Date();
		var numAttempts = 0;
		try {
			numAttempts++;
			return thunk();
		} catch (err) {
			// Check if the maximum attempts have been exceeded
			if (opts.maxAttempts && numAttempts >= opts.maxAttempts) {
				throw new MaxAttemptsException(err?.message);
			}
			// Check `canRetry` if specified
			if (opts.canRetry) {
				const retry = opts.canRetry(err);
				if (!retry.retry) {
					throw new NonretriableException(retry.message);
				}
			}
			// Check if the error is in `retryableErrors` if specified
			if (opts.retryableErrors) {
				for (var e in opts.retryableErrors) {
					if (!opts.retryableErrors.includes(e)) {
						throw e;
					}
				}
			}
			// Check if the operation has exceeded the maximum timeout
			if (opts.maximumTimeoutMs) {
				if (new Date().getMilliseconds() - startTime.getMilliseconds()) {
					throw new MaxTimeoutException(`maximumTimeoutMs ${opts.maximumTimeoutMs} exceeded`);
				}
			}

		}
	}
}

export class NonretriableException extends Error {
	constructor(public message: string, public code?: string, cause: any) {
		super(code, err);
	}
}

export class MaxTimeoutException extends Error {
	constructor(public message: string, public code?: string) {
		super(code);
	}
}

export class MaxAttemptsException extends Error {
	constructor(public message: string, public code?: string) {
		super(code);
	}
}

retry<number>(foo, {maxAttempts: 3, backoffPolicy: new LinearBackoffPolicy(100)});

async function foo():Promise<number> { 
	return Promise.resolve(3);
}
export {};