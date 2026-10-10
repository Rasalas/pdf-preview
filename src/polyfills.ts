// pdf.js (also its legacy build) calls this unguarded; Safari only has it since 17.4.
if (!('withResolvers' in Promise)) {
  Object.assign(Promise, {
    withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    },
  })
}
