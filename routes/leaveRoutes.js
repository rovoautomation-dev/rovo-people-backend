import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getLeaveTypes,
    createLeaveType,
    updateLeaveType,
    deleteLeaveType,
    getLeaveRequests,
    getMyLeaveRequests,
    getLeaveRequest,
    createLeaveRequest,
    approveLeaveRequest,
    rejectLeaveRequest,
    cancelLeaveRequest,
    getLeaveBalances,
    initializeLeaveBalances,
    getLeaveStats
} from '../controllers/leaveController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Leave Types
router.route('/types')
    .get(getLeaveTypes)
    .post(restrictTo('admin'), createLeaveType);

router.route('/types/:id')
    .patch(restrictTo('admin'), updateLeaveType)
    .delete(restrictTo('admin'), deleteLeaveType);

// Leave Requests
router.get('/stats', getLeaveStats);

router.get('/requests/my', getMyLeaveRequests);

router.route('/requests')
    .get(getLeaveRequests)
    .post(createLeaveRequest);

router.route('/requests/:id')
    .get(getLeaveRequest);

router.patch('/requests/:id/approve', restrictTo('admin', 'manager'), approveLeaveRequest);
router.patch('/requests/:id/reject', restrictTo('admin', 'manager'), rejectLeaveRequest);
router.patch('/requests/:id/cancel', cancelLeaveRequest);

// Leave Balances
router.route('/balances')
    .get(getLeaveBalances);

router.post('/balances/initialize', restrictTo('admin'), initializeLeaveBalances);

export default router;
