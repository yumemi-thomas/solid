const noop = () => {};

export function createStreamHydration(h: any) {
  const {
    getOwner,
    peekNextChildId,
    coreSignal,
    sharedConfig,
    isAsyncIterable,
    hasLoadingWindow,
    subFetch,
    readSerializedOrCompute,
    syncThenable
  } = h;

  function forwardIteratorReturn(it: any, value?: any) {
    const returned = it.return?.(value);
    return returned && typeof returned.then === "function"
      ? returned
      : syncThenable(returned ?? { done: true, value });
  }

  function pullStep(it: any) {
    try {
      return it.next();
    } catch (e) {
      const rejected = Promise.reject(e);
      rejected.catch(noop);
      return rejected;
    }
  }

  function normalizeIterator(it: any, deferFirst?: boolean) {
    let first = true;
    let buffered: any = null;
    return {
      next() {
        if (first) {
          first = false;
          const r = it.next();
          if (r && typeof r.then === "function") return r;
          return deferFirst ? Promise.resolve(r) : syncThenable(r);
        }
        if (buffered) {
          const b = buffered;
          buffered = null;
          return b;
        }
        let latest = pullStep(it);
        if (latest && typeof latest.then === "function") return latest;
        let result = latest;
        while (!latest.done) {
          const peek = pullStep(it);
          if (peek && typeof peek.then === "function") {
            buffered = peek;
            break;
          }
          latest = peek;
          if (!latest.done) result = latest;
          else if (result !== latest) buffered = Promise.resolve(latest);
        }
        return Promise.resolve(result);
      },
      return(value?: any) {
        buffered = null;
        return forwardIteratorReturn(it, value);
      }
    };
  }

  function wrapFirstYield(iterable: any, activate?: () => void, quiet?: any) {
    const srcIt = iterable[Symbol.asyncIterator]();
    let step = 0;
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (step === 0) {
              step = 1;
              return syncThenable({ done: false, value: quiet });
            }
            const p = srcIt.next();
            if (step === 1) {
              step = 2;
              return p.then((r: any) => {
                activate?.();
                return r.done ? r : { done: false, value: quiet };
              });
            }
            return p;
          },
          return(value?: any) {
            return forwardIteratorReturn(srcIt, value);
          }
        };
      }
    };
  }

  function adoptedAnswerStream(thenable: any, onLanded: () => void, onRejected: () => void) {
    let pulled = false;
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (pulled) {
              onLanded();
              return Promise.resolve({ done: true, value: undefined });
            }
            pulled = true;
            return {
              then(res: any, rej: any) {
                thenable.then(
                  (v: any) => res({ done: false, value: v }),
                  (e: any) => {
                    onRejected();
                    rej(e);
                  }
                );
              }
            };
          }
        };
      }
    };
  }

  function hydrateSignalFromAsyncIterable(coreFn: Function, compute: any, options: any): any {
    const parent = getOwner()!;
    const expectedId = peekNextChildId(parent);
    if (!sharedConfig.has!(expectedId)) return null;
    const loaded = sharedConfig.load!(expectedId);
    if (!isAsyncIterable(loaded)) return null;

    const base = normalizeIterator(loaded[Symbol.asyncIterator](), hasLoadingWindow(options));
    let terminal = false;
    const it = {
      next() {
        const p = base.next();
        return {
          then(res: any, rej: any) {
            return p.then(
              (r: any) => {
                if (r.done) terminal = true;
                return res(r);
              },
              (e: any) => {
                terminal = true;
                if (rej) return rej(e);
                throw e;
              }
            );
          }
        };
      },
      return(value?: any) {
        return base.return(value);
      }
    };
    const iterable = {
      [Symbol.asyncIterator]() {
        return it;
      }
    };
    return coreFn((prev: any) => {
      if (terminal) return compute(prev);
      subFetch(compute, prev);
      return iterable;
    }, options);
  }

  function hydrateHybridSignal(coreFn: Function, fn: any, options?: any): any {
    if (!sharedConfig.has!(peekNextChildId(getOwner()!))) return null;
    let takeover: boolean | undefined;
    const detect = (prev: any) => {
      const r = fn(prev);
      takeover = isAsyncIterable(r);
      return r;
    };
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    let live = false;
    const flip = () => {
      if (!live) setHydrated(true);
    };
    let adopted = false;
    let creating = true;
    let landedOnCreate = false;
    const result = coreFn((prev: any) => {
      if (live) return fn(prev);
      if (hydrated()) {
        live = true;
        const r = fn(prev);
        return isAsyncIterable(r) ? wrapFirstYield(r, undefined, prev) : r;
      }
      if (adopted) {
        live = true;
        return fn(prev);
      }
      let answer: any;
      try {
        answer = readSerializedOrCompute(detect, prev, options);
      } catch (e) {
        if (takeover) live = true;
        throw e;
      }
      if (!takeover) return answer;
      adopted = true;
      if (answer != null && typeof answer.then === "function")
        return adoptedAnswerStream(answer, flip, () => (live = true));
      if (creating) landedOnCreate = true;
      else queueMicrotask(flip);
      return answer;
    }, options);
    creating = false;
    if (landedOnCreate) flip();
    return result;
  }

  return [hydrateSignalFromAsyncIterable, hydrateHybridSignal, normalizeIterator];
}
