import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getDevices,
    addDevice,
    deleteDevice,
    getEmployeesToSync,
    pushEmployeesToDevices,
    getCommands
} from '../controllers/biometricDeviceController.js';
import {
    getEmployees,
    mapEmployees,
    removeFromDevice,
    getEmployeeInfo,
    getBiometricAttendance
} from '../controllers/biometricEmployeeController.js';

const router = express.Router();

// All biometric admin routes require authentication
router.use(protect);

// ── Device Management (admin only) ──────────────────────
router.route('/devices')
    .get(restrictTo('admin'), getDevices)
    .post(restrictTo('admin'), addDevice);

router.delete('/devices/:id', restrictTo('admin'), deleteDevice);

// ── Employee Sync (admin only) ──────────────────────────
router.post('/devices/sync', restrictTo('admin'), pushEmployeesToDevices);
router.get('/employees/sync-list', restrictTo('admin'), getEmployeesToSync);

// ── Commands (admin only) ───────────────────────────────
router.get('/commands', restrictTo('admin'), getCommands);

// ── Employee Mapping (admin only) ───────────────────────
router.get('/employees', restrictTo('admin'), getEmployees);
router.post('/employees/map', restrictTo('admin'), mapEmployees);
router.delete('/employees/:id/remove', restrictTo('admin'), removeFromDevice);
router.get('/employees/:id/info', restrictTo('admin'), getEmployeeInfo);

// ── Attendance Logs (admin/manager) ─────────────────────
router.get('/attendance', restrictTo('admin', 'manager'), getBiometricAttendance);

export default router;
