export async function runConcurrentQueue<T>(
  items: T[],
  concurrency: number,
  shouldStop: () => boolean,
  handler: (item: T, index: number) => Promise<void>,
) {
  if (!items.length) return
  let cursor = 0
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length))

  const worker = async () => {
    while (!shouldStop()) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await handler(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}
