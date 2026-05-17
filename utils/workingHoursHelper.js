import { Settings } from '../models/Organization.js';

/**
 * Fetch working hours configuration from the Settings model.
 * Falls back to sensible defaults (09:00 – 18:00, 8-hour day) when
 * no 'working_hours' entry exists in the database.
 */
export const getWorkingHoursConfig = async () => {
    try {
        const config = await Settings.findOne({ category: 'working_hours' });

        if (config?.settings) {
            console.log('[WorkingHours] Found config:', JSON.stringify(config.settings));
        } else {
            console.log('[WorkingHours] No config found, using defaults');
        }

        return {
            startTime: config?.settings?.startTime || '09:00',
            endTime: config?.settings?.endTime || '18:00',
            workingHoursPerDay: config?.settings?.workingHoursPerDay || 8,
        };
    } catch (error) {
        console.error('[WorkingHours] Error fetching config, using defaults:', error.message);
        return {
            startTime: '09:00',
            endTime: '18:00',
            workingHoursPerDay: 8,
        };
    }
};

/**
 * Parse a time string and return a Date object set to that time on
 * the current day (or the supplied base date).
 * 
 * Supports multiple formats:
 *   - "HH:mm"      → "10:00", "17:00"
 *   - "HH:mm:ss"   → "10:00:00"
 *   - "h:mm AM/PM"  → "10:00 AM", "5:00 PM"
 *   - "hh:mm AM/PM" → "05:00 PM"
 */
export const parseTimeToDate = (timeStr, baseDate = new Date()) => {
    const date = new Date(baseDate);

    if (!timeStr || typeof timeStr !== 'string') {
        // Fallback: noon
        date.setHours(12, 0, 0, 0);
        return date;
    }

    const trimmed = timeStr.trim().toUpperCase();

    // Check for AM/PM format
    const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (ampmMatch) {
        let hours = parseInt(ampmMatch[1], 10);
        const minutes = parseInt(ampmMatch[2], 10);
        const period = ampmMatch[4].toUpperCase();

        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;

        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    // 24-hour format: "HH:mm" or "HH:mm:ss"
    const [hours, minutes] = trimmed.split(':').map(Number);
    if (!isNaN(hours) && !isNaN(minutes)) {
        date.setHours(hours, minutes, 0, 0);
    } else {
        // Last resort fallback
        date.setHours(12, 0, 0, 0);
    }

    return date;
};
