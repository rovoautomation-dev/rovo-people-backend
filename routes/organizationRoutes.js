import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getDepartments,
    getDepartment,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getOrgStructure,
    getAnnouncements,
    getAnnouncement,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    getSettings,
    getAllSettings,
    updateSettings
} from '../controllers/organizationController.js';
import { getEmployeeHierarchy, getFullHierarchy } from '../controllers/hierarchyController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Organization Structure
router.get('/structure', getOrgStructure);

// Employee Hierarchy (role-based)
router.get('/hierarchy', getEmployeeHierarchy);
router.get('/hierarchy/full', restrictTo('admin'), getFullHierarchy);

// Departments
router.route('/departments')
    .get(getDepartments)
    .post(restrictTo('admin'), createDepartment);

router.route('/departments/:id')
    .get(getDepartment)
    .patch(restrictTo('admin'), updateDepartment)
    .delete(restrictTo('admin'), deleteDepartment);

// Announcements
router.route('/announcements')
    .get(getAnnouncements)
    .post(restrictTo('admin', 'manager'), createAnnouncement);

router.route('/announcements/:id')
    .get(getAnnouncement)
    .patch(restrictTo('admin', 'manager'), updateAnnouncement)
    .delete(restrictTo('admin', 'manager'), deleteAnnouncement);

// Settings (Admin only)
router.get('/settings', restrictTo('admin'), getAllSettings);

router.route('/settings/:category')
    .get(restrictTo('admin'), getSettings)
    .put(restrictTo('admin'), updateSettings);

export default router;
