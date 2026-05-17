import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getShortLeaveConfig,
    updateShortLeaveConfig,
    getMyMonthlyBalance,
    getAllMonthlyBalances,
    initializeMonthlyBalances,
    getShortLeaveEntries,
    getMyShortLeaveEntries,
    createShortLeaveEntry,
    approveShortLeaveEntry,
    rejectShortLeaveEntry,
    approveHalfDayAsPresent,
    getShortLeaveHistory,
    getShortLeaveStats,
    getPendingApprovalsCount
} from '../controllers/shortLeaveController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// ============ CONFIGURATION ============
router.route('/config')
    .get(getShortLeaveConfig)
    .put(restrictTo('admin'), updateShortLeaveConfig);

// ============ MONTHLY BALANCE ============
router.get('/balance', getMyMonthlyBalance);
router.get('/balances', restrictTo('admin', 'manager'), getAllMonthlyBalances);
router.post('/balance/initialize', restrictTo('admin'), initializeMonthlyBalances);

// ============ ENTRIES ============
router.get('/entries/my', getMyShortLeaveEntries);
router.route('/entries')
    .get(restrictTo('admin', 'manager'), getShortLeaveEntries)
    .post(createShortLeaveEntry);

// ============ APPROVALS ============
router.patch('/entries/:id/approve', restrictTo('admin', 'manager'), approveShortLeaveEntry);
router.patch('/entries/:id/reject', restrictTo('admin', 'manager'), rejectShortLeaveEntry);
router.patch('/:attendanceId/approve-as-present', restrictTo('admin', 'manager'), approveHalfDayAsPresent);

// ============ ANALYTICS & HISTORY ============
router.get('/history', getShortLeaveHistory);
router.get('/stats', getShortLeaveStats);
router.get('/pending-count', restrictTo('admin', 'manager'), getPendingApprovalsCount);

export default router;
