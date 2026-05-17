import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getAttendance,
    getAttendanceById,
    checkIn,
    checkOut,
    markAttendance,
    getAttendanceStats,
    getMonthlyReport,
    getHolidays,
    createHoliday,
    updateHoliday,
    deleteHoliday
} from '../controllers/attendanceController.js';
import { markMissedPunches, getISTDayRange } from '../utils/attendanceHelper.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Manual trigger to mark missed punches (admin only)
router.post('/trigger-missed-punch', restrictTo('admin'), async (req, res) => {
    try {
        const { startOfDay, endOfDay } = getISTDayRange(new Date());

        const count = await markMissedPunches(startOfDay, endOfDay, 'Manually triggered by admin');
        res.status(200).json({
            status: 'success',
            message: `${count} attendance records marked as Missed Punch`,
            data: { updatedCount: count }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to trigger missed punch update'
        });
    }
});

// Attendance stats and reports (specific routes first)
router.get('/stats', getAttendanceStats);
router.get('/monthly-report', getMonthlyReport);

// Holidays (MUST be before /:id to prevent route conflict)
router.route('/holidays')
    .get(getHolidays)
    .post(restrictTo('admin'), createHoliday);

router.route('/holidays/:id')
    .patch(restrictTo('admin'), updateHoliday)
    .delete(restrictTo('admin'), deleteHoliday);

// Check-in/out
router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.post('/mark', restrictTo('admin', 'manager'), markAttendance);

// Base attendance routes (generic routes last)
router.route('/')
    .get(getAttendance);

router.route('/:id')
    .get(getAttendanceById);

export default router;
