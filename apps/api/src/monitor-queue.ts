import { PgBoss } from "pg-boss";

export const MONITOR_JOB = "flight-lens-monitor-alert";

export type MonitorQueue = {
  start(handler: (alertId: string) => Promise<void>): Promise<void>;
  enqueue(alertId: string, runAt?: Date): Promise<string | null>;
  stop(): Promise<void>;
};

export function monitorJobOptions(alertId: string, executionTimeoutMs: number, runAt?: Date) {
  return {
    singletonKey: alertId,
    singletonSeconds: 300,
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: Math.max(5, Math.ceil(executionTimeoutMs / 1_000)),
    ...(runAt ? { startAfter: runAt } : {}),
  };
}

export function createMonitorQueue(databaseUrl: string, executionTimeoutMs = 45_000): MonitorQueue {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
  return {
    async start(handler) {
      await boss.start();
      await boss.createQueue(MONITOR_JOB);
      await boss.work<{ alertId: string }>(MONITOR_JOB, { batchSize: 1 }, async (jobs) => {
        for (const job of jobs) await handler(job.data.alertId);
      });
    },
    async enqueue(alertId, runAt) {
      return boss.send(MONITOR_JOB, { alertId }, monitorJobOptions(alertId, executionTimeoutMs, runAt));
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 5_000 });
    },
  };
}
