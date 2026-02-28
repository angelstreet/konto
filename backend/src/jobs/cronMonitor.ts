/**
 * Cron job monitoring system
 * Tracks last run times and status of all scheduled jobs
 */

interface CronJobStatus {
  name: string;
  schedule: string;
  lastRun: Date | null;
  lastStatus: 'success' | 'error' | 'running' | 'never_run';
  lastError?: string;
  runCount: number;
  errorCount: number;
}

class CronMonitor {
  private jobs: Map<string, CronJobStatus> = new Map();

  registerJob(name: string, schedule: string) {
    this.jobs.set(name, {
      name,
      schedule,
      lastRun: null,
      lastStatus: 'never_run',
      runCount: 0,
      errorCount: 0,
    });
    console.log(`✅ Registered cron job: ${name} (${schedule})`);
  }

  startRun(jobName: string) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.lastStatus = 'running';
      console.log(`▶️  Starting cron job: ${jobName}`);
    }
  }

  recordSuccess(jobName: string, details?: string) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.lastRun = new Date();
      job.lastStatus = 'success';
      job.runCount++;
      delete job.lastError;
      console.log(`✅ Cron job completed: ${jobName}${details ? ` - ${details}` : ''}`);
    }
  }

  recordError(jobName: string, error: Error | string) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.lastRun = new Date();
      job.lastStatus = 'error';
      job.errorCount++;
      job.lastError = error instanceof Error ? error.message : error;
      console.error(`❌ Cron job failed: ${jobName} - ${job.lastError}`);
    }
  }

  getStatus(jobName?: string): CronJobStatus | CronJobStatus[] | null {
    if (jobName) {
      return this.jobs.get(jobName) || null;
    }
    return Array.from(this.jobs.values());
  }

  getAllJobs() {
    return Array.from(this.jobs.values()).map(job => ({
      ...job,
      lastRun: job.lastRun?.toISOString() || null,
      uptime: job.lastRun ? Date.now() - job.lastRun.getTime() : null,
      healthy: job.lastStatus === 'success' || job.lastStatus === 'never_run',
    }));
  }

  isHealthy(): boolean {
    for (const job of this.jobs.values()) {
      // If a job has run and the last status was an error, consider it unhealthy
      if (job.lastRun && job.lastStatus === 'error') {
        return false;
      }
      // If a job hasn't run in the last 25 hours (for daily jobs), consider it unhealthy
      if (job.lastRun && Date.now() - job.lastRun.getTime() > 25 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
  }
}

export const cronMonitor = new CronMonitor();
