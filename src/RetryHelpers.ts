import { predicate } from "fp-ts";
import { PredicateWithIndex } from "fp-ts/lib/FilterableWithIndex";
import { composeIso } from "monocle-ts/Iso";
// import { Newtype, iso } from "newtype-ts";
import { EventEmitter } from "node:events";

export type AsyncFunction<ReturnType = void> = (
	args?: any[]
) => Promise<ReturnType>;

const sleep: (ms?: number) => void = (ms?: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOption {
	/**
	 * Determines whether retrying is allowed, and if not, throws an exception
	 * describing why
	 */
	checkRetryAllowed?(numAttempts: number, timestamp: Date, err?): void;
	/**
	 * If retrying is allowed, determines this option's contributions to the
	 * milliseconds of waiting before the new retry is permitted.
	 */
	retryDelayMs?(previousDelayMs: number, timestamp: Date): number;
}

class MaxAttemptsRetryAllowed implements RetryOption {
	private attempts = 0;
	constructor(public maxAttempts: number) {}

	checkRetryAllowed(numAttempts: number, timestamp: Date, err?): void {
		this.attempts++;
		if (this.attempts >= this.maxAttempts) {
			throw new MaxAttemptsException(
				`Max attempts exceeded: ${this.attempts}`,
				"429"
			);
		}
	}
}

type Attempts = number;
type MillisecondsT = number;

/**
 * An option that implements linear backoff between retry attempts
 */
class LinearBackoff implements RetryOption {
	private attempts = 0;
	private currentDelay: number = 0;
	timeout: NodeJS.Timeout;

	/**
	 * Upon each retry attempt, the delay before the next
	 * retry will grow by the addition of @param delay.
	 */
	constructor(private readonly delay: number) {}

	retryDelayMs(previousDelayMs: number, timestamp: Date): number {
		this.currentDelay += this.delay;
		const delay = previousDelayMs + this.currentDelay;
		var r = (this.timeout = setTimeout(() => {
			clearTimeout(r);
			throw new MaxTimeout(delay);
		}, delay));
		return this.currentDelay;
	}
}

/**
 * An option that will abort retrying if the time spent exceeds the specified time retrying
 */
export class MaxTimeout implements RetryOption {
	/**
	 * @param totalTimeoutMs The total time that if exceeded will cause retries to abort.
	 */
	constructor(private totalTimeoutMs: number) {}
	checkRetryAllowed(numAttempts: number, timestamp: Date, err?): void {
		if (timestamp.getTime() >= this.totalTimeoutMs) {
			this.throwTimeout();
		}
		setTimeout(() => {
			eventEmitter.emit(TIMEOUT, this.throwTimeout());
		}, this.totalTimeoutMs - timestamp.getTime());
	}

	private throwTimeout():never {
		throw new MaxTimeoutException(
			`Attempt took longer than maximum specified ${this.totalTimeoutMs} milliseconds`,
			"408"
		);
	}
}

export class MaxTimeoutException extends Error {
	constructor(
		readonly message: string,
		readonly code: string = null,
		readonly cause?: any
	) {
		super(code);
	}
}

/**
 * An option that allows specifying exception (Error) types that
 * are considered retriable. If this option is specified, any
 * exceptions that are thrown and not included in the list
 * will abort the retry attempt and propagate
 */
class RetriableExceptions implements RetryOption {
	constructor(private readonly errors: Error[]) {}
	checkRetryAllowed(numAttempts: number, timestamp: Date, err?): void {
		if (this.errors.includes(err)) {
			return;
		} else {
			throw new NonretriableException(
				`Attempt threw nonretriable exception: ${typeof err}`,
				"500",
				err
			);
		}
	}
}

export class NonretriableException extends Error {
	constructor(public message: string, public code: string, public cause?: any) {
		super(code);
	}
}

export class MaxAttemptsException extends Error {
	constructor(
		public message: string,
		public code: string = null,
		public cause?: any
	) {
		super(code);
	}
}

declare const TIMEOUT: unique symbol;
const eventEmitter = new EventEmitter();

export class RetryHelper<T> {
	readonly startTimestamp = new Date();
	constructor(
		readonly f: AsyncFunction,
		readonly args?: any[],
		readonly options: RetryOption[] = []
	) {}

	timeoutErr?: Error;
	timeout: boolean;

	add(opt: RetryOption) {
		this.options.push(opt);
	}

	async run() {
		var numAttempts = 0;
		var delayMs = 0;
		/**
		 * Create an EventEmitter so that if
		 * one of the RetryOption has decided
		 * that the attempt has been exhausted, 
		 * it can notify this function and throw an exception
		 */
		const onErr = (err) => {
			this.timeout = true;
			this.timeoutErr = err;
		};
		onErr.bind(this);
		eventEmitter.on(TIMEOUT, onErr);
		try {
			numAttempts++;
			const result = await this.f(...this.args);
		} catch (err) {
			const currentTimestamp = new Date();
			for (var opt of this.options) {
				if (opt.checkRetryAllowed) {
					opt.checkRetryAllowed(numAttempts, currentTimestamp, err);
				}
				if (opt.retryDelayMs) {
					delayMs = opt.retryDelayMs(delayMs, currentTimestamp);
				}
			}
		}
	}
}
