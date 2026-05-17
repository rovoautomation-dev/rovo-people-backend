import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    createTask,
    getTasks,
    getMyTasks,
    getTeamTasks,
    getTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    getComments,
    addComment,
    addAttachment,
    deleteAttachment,
    getTaskStats,
    getOverviewStats,
    getStatsByEmployee,
    getTeamMembers,
    upload
} from '../controllers/taskController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Team members (for assignment dropdown)
router.get('/team-members', restrictTo('admin', 'manager'), getTeamMembers);

// Analytics routes (before /:id to avoid conflicts)
router.get('/stats', restrictTo('admin', 'manager'), getTaskStats);
router.get('/analytics/overview', restrictTo('admin', 'manager'), getOverviewStats);
router.get('/analytics/by-employee', restrictTo('admin', 'manager'), getStatsByEmployee);

// Employee's own tasks
router.get('/my', getMyTasks);

// Team tasks (manager/admin)
router.get('/team', restrictTo('admin', 'manager'), getTeamTasks);

// Task CRUD
router.route('/')
    .get(getTasks)
    .post(restrictTo('admin', 'manager'), createTask);

router.route('/:id')
    .get(getTask)
    .patch(updateTask)
    .delete(restrictTo('admin', 'manager'), deleteTask);

// Quick status update
router.patch('/:id/status', updateTaskStatus);

// Comments
router.route('/:id/comments')
    .get(getComments)
    .post(addComment);

// Attachments
router.post('/:id/attachments', upload.single('file'), addAttachment);
router.delete('/:id/attachments/:attachmentId', deleteAttachment);

export default router;
