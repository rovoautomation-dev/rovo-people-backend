import express from 'express';
import {
    getEmployees,
    getEmployee,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    getDashboardStats,
    getDepartments
} from '../controllers/employeeController.js';
import { uploadProfileImage } from '../config/cloudinary.js';

const router = express.Router();

// Dashboard stats (must be before /:id route)
router.get('/stats', getDashboardStats);

// Departments list
router.get('/departments', getDepartments);

// CRUD routes
router.route('/')
    .get(getEmployees)
    .post(uploadProfileImage.single('profileImage'), createEmployee);

router.route('/:id')
    .get(getEmployee)
    .put(uploadProfileImage.single('profileImage'), updateEmployee)
    .delete(deleteEmployee);

export default router;
