import express from 'express';
import {
    register,
    login,
    protect,
    restrictTo,
    getMe,
    updatePassword,
    getAllUsers,
    updateUser,
    deleteUser,
    setupAdmin,
    updateFCMToken
} from '../controllers/authController.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/setup-admin', setupAdmin);

// Protected routes (require authentication)
router.use(protect);

router.get('/me', getMe);
router.patch('/update-password', updatePassword);
router.patch('/fcm-token', updateFCMToken);

// Admin only routes
router.get('/users', restrictTo('admin'), getAllUsers);
router.patch('/users/:id', restrictTo('admin'), updateUser);
router.delete('/users/:id', restrictTo('admin'), deleteUser);

export default router;
