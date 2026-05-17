import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    createOnDutyRequest,
    getMyOnDutyRequests,
    getAllOnDutyRequests,
    getActiveOnDutyEmployees,
    getOnDutyRequest,
    approveOnDutyRequest,
    rejectOnDutyRequest,
    startTracking,
    updateLocation,
    stopTracking,
    getLocationHistory,
    reportLocationDisabled,
    reportPermissionEvent,
    getPermissionHistory
} from '../controllers/onDutyController.js';

const router = express.Router();

// Protect all routes - require authentication
router.use(protect);

// ============ EMPLOYEE ROUTES ============

// Apply for on-duty
router.post('/', createOnDutyRequest);

// Get my on-duty requests
router.get('/my-requests', getMyOnDutyRequests);

// Start tracking
router.post('/:id/start-tracking', startTracking);

// Update location (every 5 minutes ping)
router.post('/:id/location', updateLocation);

// Stop tracking
router.post('/:id/stop-tracking', stopTracking);

// Report location disabled (legacy endpoint)
router.post('/:id/alert', reportLocationDisabled);

// Report permission event (new comprehensive endpoint)
router.post('/:id/permission-event', reportPermissionEvent);

// ============ ADMIN/MANAGER ROUTES ============

// Get all on-duty requests
router.get('/', restrictTo('admin', 'manager'), getAllOnDutyRequests);

// Get active tracking employees
router.get('/active', restrictTo('admin', 'manager'), getActiveOnDutyEmployees);

// Get single request
router.get('/:id', getOnDutyRequest);

// Get location history
router.get('/:id/history', restrictTo('admin', 'manager'), getLocationHistory);

// Get permission history
router.get('/:id/permission-history', restrictTo('admin', 'manager'), getPermissionHistory);

// Approve request
router.put('/:id/approve', restrictTo('admin', 'manager'), approveOnDutyRequest);

// Reject request
router.put('/:id/reject', restrictTo('admin', 'manager'), rejectOnDutyRequest);

export default router;
