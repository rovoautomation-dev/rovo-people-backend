import cron from 'node-cron';
import { autoRejectExpiredEntries } from '../controllers/shortLeaveController.js';
import { autoMarkMissedPunches, markMissedPunches, getISTDayRange } from './attendanceHelper.js';

/**
 * Initialize all scheduled jobs
 */
export const initScheduler = () => {
    // ── 1. Auto-reject expired short-leave entries at midnight IST ──
    cron.schedule('0 0 * * *', async () => {
        console.log('[CRON] Running midnight auto-rejection job...');
        try {
            const result = await autoRejectExpiredEntries();
            console.log(`[CRON] Auto-rejection complete: ${result.rejected} entries processed`);
        } catch (error) {
            console.error('[CRON] Auto-rejection job failed:', error);
        }
    }, {
        timezone: 'Asia/Kolkata'
    });

    // ── 2. Mark missed punches at midnight IST (for YESTERDAY's records) ──
    cron.schedule('0 0 * * *', async () => {
        console.log('[CRON] Running midnight missed-punch job...');
        try {
            // Get yesterday's date in IST
            const now = new Date();
            const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            const istNow = new Date(istString);
            const yesterday = new Date(istNow);
            yesterday.setDate(yesterday.getDate() - 1);

            const { startOfDay, endOfDay } = getISTDayRange(yesterday);

            console.log(`[CRON] Looking for yesterday's open check-ins: ${startOfDay.toISOString()} to ${endOfDay.toISOString()} (IST)`);

            const count = await markMissedPunches(startOfDay, endOfDay, 'Auto-marked: no check-out recorded (midnight job)');
            console.log(`[CRON] Midnight missed-punch: ${count} records updated`);
        } catch (error) {
            console.error('[CRON] Midnight missed-punch job failed:', error);
        }
    }, {
        timezone: 'Asia/Kolkata'
    });

    // ── 3. End-of-day missed-punch check (runs every 1 minute IST) ──
    cron.schedule('* * * * *', async () => {
        try {
            // Re-use the advanced logic from the helper
            await autoMarkMissedPunches();
        } catch (error) {
            console.error('[CRON] Minutely missed-punch check failed:', error);
        }
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('[SCHEDULER] ✅ Advanced Cron jobs initialized:');
    console.log('  - Midnight auto-rejection (00:00 IST)');
    console.log('  - Midnight missed-punch (00:00 IST)');
    console.log('  - Advanced missed-punch auto-detector (every 1 min IST)');
};
