import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    startTracking,
    stopTracking,
    updateLocation,
    getLocationHistory,
    getEmployeeLocationHistory,
    reportLocationDisabled,
    reportLocationEnabled,
    getPermissionDisableHistory,
    getCurrentTrackingStatus
} from '../controllers/attendanceLocationController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Current user tracking status
router.get('/tracking-status', getCurrentTrackingStatus);

// Start/stop tracking
router.post('/:id/start-tracking', startTracking);
router.post('/:id/stop-tracking', stopTracking);

// Location updates
router.post('/:id/location', updateLocation);
router.get('/:id/location-history', getLocationHistory);

// Employee location history (admin/manager)
router.get('/employee/:employeeId/history', restrictTo('admin', 'manager'), getEmployeeLocationHistory);
router.get('/employee/:employeeId/permission-history', restrictTo('admin', 'manager'), getPermissionDisableHistory);

// Permission alerts
router.post('/location-disabled-alert', reportLocationDisabled);
router.post('/location-enabled-alert', reportLocationEnabled);

export default router;
