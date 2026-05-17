import { Attendance } from '../models/Attendance.js';
import { getWorkingHoursConfig, parseTimeToDate } from './workingHoursHelper.js';

/**
 * Mark open check-ins as Missed Punch for a given IST-aware day range.
 */
export const markMissedPunches = async (startOfDay, endOfDay, reason = '') => {
    try {
        const result = await Attendance.updateMany(
            {
                date: { $gte: startOfDay, $lte: endOfDay },
                checkIn: { $ne: null },
                checkOut: null,
                status: { $nin: ['Missed Punch', 'On Leave', 'Holiday', 'Weekend'] }
            },
            {
                $set: {
                    missedPunch: true,
                    status: 'Missed Punch',
                    notes: reason || 'Auto-marked: no check-out recorded'
                }
            }
        );
        return result.modifiedCount;
    } catch (error) {
        console.error('[AttendanceHelper] Error in markMissedPunches:', error.message);
        throw error;
    }
};

/**
 * Auto-detect and mark missed punches for the current day based on IST time.
 * Logic: If current time > configured End Time, any open record for today
 * is updated in the database.
 */
export const autoMarkMissedPunches = async () => {
    try {
        const config = await getWorkingHoursConfig();
        const now = new Date();

        // Get IST current time
        const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const currentHours = istNow.getHours();
        const currentMinutes = istNow.getMinutes();

        // Parse configured End Time
        const endTime = parseTimeToDate(config.endTime);
        const endHours = endTime.getHours();
        const endMinutes = endTime.getMinutes();

        // Determine if we are past the end of the work day (IST)
        const isPastEndTime = (currentHours > endHours) || (currentHours === endHours && currentMinutes > endMinutes);

        if (!isPastEndTime) return 0;

        // Today's range in IST
        const startOfDay = new Date(istNow);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(istNow);
        endOfDay.setHours(23, 59, 59, 999);

        const count = await markMissedPunches(
            startOfDay,
            endOfDay,
            `Auto-marked: no check-out after ${config.endTime} (IST)`
        );

        if (count > 0) {
            console.log(`[AttendanceHelper] ✅ Auto-marked ${count} records as Missed Punch (endTime: ${config.endTime})`);
        }
        return count;
    } catch (error) {
        console.error('[AttendanceHelper] Error in autoMarkMissedPunches:', error.message);
        return 0;
    }
};

/**
 * Get start and end of a given day as Date range (IST-aware).
 */
export const getISTDayRange = (baseDate = new Date()) => {
    const istString = baseDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    const istDate = new Date(istString);

    const startOfDay = new Date(istDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(istDate);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay };
};
