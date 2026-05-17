import { Task, TaskComment, TaskActivity } from '../models/Task.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import { cloudinary } from '../config/cloudinary.js';
import multer from 'multer';
import { notifyTaskAssigned, notifyTaskUpdated, notifyTaskStatusChanged, notifyTaskComment } from './notificationController.js';

// Multer configuration for file uploads
const storage = multer.memoryStorage();
export const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Helper: Get team member IDs for a manager
const getTeamMemberIds = async (managerId) => {
    const manager = await Employee.findById(managerId);
    if (!manager) return [];

    // Get employees who report to this manager
    const teamMembers = await Employee.find({
        reportingManager: managerId,
        status: 'Active'
    }).select('_id');

    return teamMembers.map(e => e._id);
};

// Helper: Check if user can access task
const canAccessTask = async (userId, taskId, role) => {
    const task = await Task.findById(taskId).populate('assignee');
    if (!task || task.isDeleted) return { allowed: false, task: null };

    if (role === 'admin') return { allowed: true, task };

    // Get user's employee record
    const user = await User.findById(userId).populate('employee');
    let employeeId = user?.employee?._id;

    // Fallback: if employee not linked, try to find by email
    if (!employeeId && user?.email) {
        const foundEmployee = await Employee.findOne({ email: user.email });
        if (foundEmployee) {
            employeeId = foundEmployee._id;
        }
    }

    if (!employeeId) return { allowed: false, task: null };

    // Manager can access team tasks
    if (role === 'manager') {
        const teamIds = await getTeamMemberIds(employeeId);
        const isTeamTask = teamIds.some(id => id.toString() === task.assignee._id.toString());
        return { allowed: isTeamTask, task };
    }

    // Employee can only access own tasks
    const isOwnTask = task.assignee._id.toString() === employeeId.toString();
    return { allowed: isOwnTask, task };
};


// Helper: Log activity
const logActivity = async (taskId, userId, action, details = {}) => {
    try {
        await TaskActivity.create({
            task: taskId,
            user: userId,
            action,
            details
        });
    } catch (error) {
        console.error('Failed to log activity:', error);
    }
};

// ============================================
// CRUD Operations
// ============================================

// @desc    Create a new task
// @route   POST /api/tasks
// @access  Manager/Admin
export const createTask = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Only managers and admins can create tasks'
            });
        }

        const {
            title, description, assignee, priority, category,
            startDate, dueDate, estimatedHours, tags, subtasks
        } = req.body;

        // Validate assignee exists
        const employee = await Employee.findById(assignee);
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Assignee not found'
            });
        }

        // For managers, verify assignee is in their team
        if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            let managerEmployeeId = user?.employee?._id;

            // Fallback: if employee not linked, try to find by email
            if (!managerEmployeeId && req.user.email) {
                const foundManager = await Employee.findOne({ email: req.user.email });
                if (foundManager) {
                    managerEmployeeId = foundManager._id;
                }
            }

            if (managerEmployeeId) {
                const teamIds = await getTeamMemberIds(managerEmployeeId);
                const isTeamMember = teamIds.some(id => id.toString() === assignee);
                if (!isTeamMember) {
                    return res.status(403).json({
                        success: false,
                        message: 'You can only assign tasks to your team members'
                    });
                }
            }
        }

        const task = await Task.create({
            title,
            description,
            assignee,
            createdBy: req.user.id,
            priority: priority || 'Medium',
            category: category || 'Other',
            startDate,
            dueDate,
            estimatedHours,
            tags: tags || [],
            subtasks: subtasks || []
        });

        await task.populate('assignee', 'firstName lastName email profileImage');
        await task.populate('createdBy', 'email');

        // Log activity
        await logActivity(task._id, req.user.id, 'created', {
            title: task.title,
            assignee: `${employee.firstName} ${employee.lastName}`
        });

        // Send notification to assignee
        await notifyTaskAssigned(task, employee, req.user, req.app);

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: task
        });
    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create task',
            error: error.message
        });
    }
};

// @desc    Get all tasks (filtered by role)
// @route   GET /api/tasks
// @access  Protected
export const getTasks = async (req, res) => {
    try {
        const { role } = req.user;
        const { status, priority, category, assignee, search, page = 1, limit = 50 } = req.query;

        let query = { isDeleted: false };

        // Role-based filtering
        if (role === 'employee') {
            const user = await User.findById(req.user.id).populate('employee');
            let employeeId = user?.employee?._id;

            // Fallback: if employee not linked, try to find by email
            if (!employeeId && req.user.email) {
                const foundEmployee = await Employee.findOne({ email: req.user.email });
                if (foundEmployee) {
                    employeeId = foundEmployee._id;
                }
            }

            if (!employeeId) {
                return res.json({
                    success: true,
                    data: [],
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: 0,
                        pages: 0
                    }
                });
            }
            query.assignee = employeeId;
        } else if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            let managerEmployeeId = user?.employee?._id;

            // Fallback: if employee not linked, try to find by email
            if (!managerEmployeeId && req.user.email) {
                const foundManager = await Employee.findOne({ email: req.user.email });
                if (foundManager) {
                    managerEmployeeId = foundManager._id;
                }
            }

            if (managerEmployeeId) {
                const teamIds = await getTeamMemberIds(managerEmployeeId);
                query.assignee = { $in: teamIds };
            }
        }
        // Admin sees all tasks

        // Apply filters
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (category) query.category = category;
        if (assignee && (role === 'admin' || role === 'manager')) {
            query.assignee = assignee;
        }
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [tasks, total] = await Promise.all([
            Task.find(query)
                .populate('assignee', 'firstName lastName email profileImage')
                .populate('createdBy', 'email')
                .sort({ priority: -1, dueDate: 1, createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Task.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: tasks,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tasks',
            error: error.message
        });
    }
};

// @desc    Get my tasks (for employees)
// @route   GET /api/tasks/my
// @access  Protected
export const getMyTasks = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('employee');
        let employeeId = user?.employee?._id;

        // Fallback: if employee not linked, try to find by email
        if (!employeeId && req.user.email) {
            const foundEmployee = await Employee.findOne({ email: req.user.email });
            if (foundEmployee) {
                employeeId = foundEmployee._id;
            }
        }

        if (!employeeId) {
            return res.json({
                success: true,
                data: [],
                grouped: {
                    'Todo': [],
                    'In Progress': [],
                    'In Review': [],
                    'Completed': [],
                    'Blocked': []
                }
            });
        }

        const { status, priority } = req.query;
        let query = {
            assignee: employeeId,
            isDeleted: false
        };

        if (status) query.status = status;
        if (priority) query.priority = priority;

        const tasks = await Task.find(query)
            .populate('assignee', 'firstName lastName email profileImage')
            .populate('createdBy', 'email')
            .sort({ priority: -1, dueDate: 1, createdAt: -1 });

        // Group by status for Kanban view
        const grouped = {
            'Todo': tasks.filter(t => t.status === 'Todo'),
            'In Progress': tasks.filter(t => t.status === 'In Progress'),
            'In Review': tasks.filter(t => t.status === 'In Review'),
            'Completed': tasks.filter(t => t.status === 'Completed'),
            'Blocked': tasks.filter(t => t.status === 'Blocked')
        };

        res.json({
            success: true,
            data: tasks,
            grouped
        });
    } catch (error) {
        console.error('Get my tasks error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tasks',
            error: error.message
        });
    }
};

// @desc    Get team tasks (for managers)
// @route   GET /api/tasks/team
// @access  Manager/Admin
export const getTeamTasks = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let query = { isDeleted: false };

        if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            let managerEmployeeId = user?.employee?._id;

            // Fallback: if employee not linked, try to find by email
            if (!managerEmployeeId && req.user.email) {
                const foundManager = await Employee.findOne({ email: req.user.email });
                if (foundManager) {
                    managerEmployeeId = foundManager._id;
                }
            }

            if (managerEmployeeId) {
                const teamIds = await getTeamMemberIds(managerEmployeeId);
                query.assignee = { $in: teamIds };
            }
        }

        const { status, priority, assignee } = req.query;
        if (status) query.status = status;
        if (priority) query.priority = priority;
        if (assignee) query.assignee = assignee;

        const tasks = await Task.find(query)
            .populate('assignee', 'firstName lastName email profileImage')
            .populate('createdBy', 'email')
            .sort({ priority: -1, dueDate: 1, createdAt: -1 });

        // Group by status for Kanban view
        const grouped = {
            'Todo': tasks.filter(t => t.status === 'Todo'),
            'In Progress': tasks.filter(t => t.status === 'In Progress'),
            'In Review': tasks.filter(t => t.status === 'In Review'),
            'Completed': tasks.filter(t => t.status === 'Completed'),
            'Blocked': tasks.filter(t => t.status === 'Blocked')
        };

        res.json({
            success: true,
            data: tasks,
            grouped
        });
    } catch (error) {
        console.error('Get team tasks error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tasks',
            error: error.message
        });
    }
};

// @desc    Get single task
// @route   GET /api/tasks/:id
// @access  Protected
export const getTask = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        await task.populate('assignee', 'firstName lastName email profileImage department');
        await task.populate('createdBy', 'email');
        await task.populate('dependencies', 'title status');
        await task.populate('watchers', 'firstName lastName email');

        // Get comments and activities
        const [comments, activities] = await Promise.all([
            TaskComment.find({ task: task._id })
                .populate('author', 'email')
                .sort({ createdAt: -1 })
                .limit(50),
            TaskActivity.find({ task: task._id })
                .populate('user', 'email')
                .sort({ createdAt: -1 })
                .limit(20)
        ]);

        res.json({
            success: true,
            data: {
                ...task.toObject(),
                comments,
                activities
            }
        });
    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch task',
            error: error.message
        });
    }
};

// @desc    Update task
// @route   PATCH /api/tasks/:id
// @access  Protected
export const updateTask = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const { role } = req.user;
        const allowedFields = role === 'employee'
            ? ['status', 'actualHours', 'subtasks']
            : ['title', 'description', 'assignee', 'status', 'priority', 'category',
                'startDate', 'dueDate', 'estimatedHours', 'actualHours', 'tags', 'subtasks'];

        const updates = {};
        const changes = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                changes[field] = { old: task[field], new: req.body[field] };
                updates[field] = req.body[field];
            }
        }

        const updatedTask = await Task.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        )
            .populate('assignee', 'firstName lastName email profileImage')
            .populate('createdBy', 'email');

        // Log activity
        await logActivity(task._id, req.user.id, 'updated', changes);

        res.json({
            success: true,
            message: 'Task updated successfully',
            data: updatedTask
        });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update task',
            error: error.message
        });
    }
};

// @desc    Quick status update
// @route   PATCH /api/tasks/:id/status
// @access  Protected
export const updateTaskStatus = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const { status } = req.body;
        const validStatuses = ['Todo', 'In Progress', 'In Review', 'Completed', 'Blocked'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        const oldStatus = task.status;
        task.status = status;
        await task.save();

        await task.populate('assignee', 'firstName lastName email profileImage');

        // Log activity
        await logActivity(task._id, req.user.id, 'status_changed', {
            oldStatus,
            newStatus: status
        });

        // Notify relevant users about status change
        // Get task creator's user ID and assignee's user ID
        const creatorUser = await User.findById(task.createdBy);
        const assigneeUser = await User.findOne({ employee: task.assignee._id });
        const recipientIds = [];
        if (creatorUser) recipientIds.push(creatorUser._id);
        if (assigneeUser && !recipientIds.includes(assigneeUser._id)) recipientIds.push(assigneeUser._id);

        await notifyTaskStatusChanged(task, oldStatus, status, req.user, recipientIds, req.app);

        res.json({
            success: true,
            message: 'Status updated successfully',
            data: task
        });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status',
            error: error.message
        });
    }
};

// @desc    Delete task (soft delete)
// @route   DELETE /api/tasks/:id
// @access  Manager/Admin
export const deleteTask = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Only managers and admins can delete tasks'
            });
        }

        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        task.isDeleted = true;
        task.deletedAt = new Date();
        task.deletedBy = req.user.id;
        await task.save();

        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete task',
            error: error.message
        });
    }
};

// ============================================
// Comments
// ============================================

// @desc    Get comments for a task
// @route   GET /api/tasks/:id/comments
// @access  Protected
export const getComments = async (req, res) => {
    try {
        const { allowed } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const comments = await TaskComment.find({ task: req.params.id })
            .populate('author', 'email')
            .populate('mentions', 'firstName lastName email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: comments
        });
    } catch (error) {
        console.error('Get comments error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch comments',
            error: error.message
        });
    }
};

// @desc    Add comment to task
// @route   POST /api/tasks/:id/comments
// @access  Protected
export const addComment = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const { content, mentions } = req.body;

        if (!content || content.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Comment content is required'
            });
        }

        const comment = await TaskComment.create({
            task: req.params.id,
            author: req.user.id,
            content: content.trim(),
            mentions: mentions || []
        });

        await comment.populate('author', 'email');
        await comment.populate('mentions', 'firstName lastName email');

        // Log activity
        await logActivity(req.params.id, req.user.id, 'commented', {
            commentId: comment._id
        });

        // Notify task participants about the comment
        const creatorUser = await User.findById(task.createdBy);
        const assigneeUser = await User.findOne({ employee: task.assignee._id });
        const recipientIds = [];
        if (creatorUser) recipientIds.push(creatorUser._id);
        if (assigneeUser && !recipientIds.includes(assigneeUser._id)) recipientIds.push(assigneeUser._id);

        await notifyTaskComment(task, comment, req.user, recipientIds, req.app);

        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: comment
        });
    } catch (error) {
        console.error('Add comment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add comment',
            error: error.message
        });
    }
};

// ============================================
// Attachments
// ============================================

// @desc    Add attachment to task
// @route   POST /api/tasks/:id/attachments
// @access  Protected
export const addAttachment = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        // Upload to Cloudinary
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;

        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'hr-tasks',
            resource_type: 'auto'
        });

        const attachment = {
            name: req.file.originalname,
            url: result.secure_url,
            publicId: result.public_id,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            uploadedBy: req.user.id,
            uploadedAt: new Date()
        };

        task.attachments.push(attachment);
        await task.save();

        // Log activity
        await logActivity(task._id, req.user.id, 'attachment_added', {
            fileName: req.file.originalname
        });

        res.status(201).json({
            success: true,
            message: 'Attachment uploaded successfully',
            data: attachment
        });
    } catch (error) {
        console.error('Add attachment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload attachment',
            error: error.message
        });
    }
};

// @desc    Delete attachment from task
// @route   DELETE /api/tasks/:id/attachments/:attachmentId
// @access  Protected
export const deleteAttachment = async (req, res) => {
    try {
        const { allowed, task } = await canAccessTask(req.user.id, req.params.id, req.user.role);

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        const attachment = task.attachments.id(req.params.attachmentId);

        if (!attachment) {
            return res.status(404).json({
                success: false,
                message: 'Attachment not found'
            });
        }

        // Only uploader, manager, or admin can delete
        const { role } = req.user;
        if (role === 'employee' && attachment.uploadedBy.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own attachments'
            });
        }

        // Delete from Cloudinary
        if (attachment.publicId) {
            await cloudinary.uploader.destroy(attachment.publicId);
        }

        task.attachments.pull(req.params.attachmentId);
        await task.save();

        // Log activity
        await logActivity(task._id, req.user.id, 'attachment_removed', {
            fileName: attachment.name
        });

        res.json({
            success: true,
            message: 'Attachment deleted successfully'
        });
    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete attachment',
            error: error.message
        });
    }
};

// ============================================
// Analytics & Reporting
// ============================================

// @desc    Get task statistics
// @route   GET /api/tasks/stats
// @access  Manager/Admin
export const getTaskStats = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let matchQuery = { isDeleted: false };

        if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            if (user?.employee) {
                const teamIds = await getTeamMemberIds(user.employee._id);
                matchQuery.assignee = { $in: teamIds };
            }
        }

        const [statusStats, priorityStats, categoryStats, overdueCount, totalTasks] = await Promise.all([
            Task.aggregate([
                { $match: matchQuery },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            Task.aggregate([
                { $match: matchQuery },
                { $group: { _id: '$priority', count: { $sum: 1 } } }
            ]),
            Task.aggregate([
                { $match: matchQuery },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Task.countDocuments({
                ...matchQuery,
                dueDate: { $lt: new Date() },
                status: { $ne: 'Completed' }
            }),
            Task.countDocuments(matchQuery)
        ]);

        res.json({
            success: true,
            data: {
                totalTasks,
                overdueCount,
                byStatus: statusStats,
                byPriority: priorityStats,
                byCategory: categoryStats
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics',
            error: error.message
        });
    }
};

// @desc    Get overview analytics
// @route   GET /api/tasks/analytics/overview
// @access  Manager/Admin
export const getOverviewStats = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let matchQuery = { isDeleted: false };

        if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            if (user?.employee) {
                const teamIds = await getTeamMemberIds(user.employee._id);
                matchQuery.assignee = { $in: teamIds };
            }
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const [
            totalTasks,
            completedThisMonth,
            createdThisMonth,
            overdueTasks,
            avgCompletionTime
        ] = await Promise.all([
            Task.countDocuments(matchQuery),
            Task.countDocuments({
                ...matchQuery,
                status: 'Completed',
                completedAt: { $gte: startOfMonth, $lte: endOfMonth }
            }),
            Task.countDocuments({
                ...matchQuery,
                createdAt: { $gte: startOfMonth, $lte: endOfMonth }
            }),
            Task.find({
                ...matchQuery,
                dueDate: { $lt: now },
                status: { $ne: 'Completed' }
            })
                .populate('assignee', 'firstName lastName')
                .sort({ dueDate: 1 })
                .limit(10),
            Task.aggregate([
                { $match: { ...matchQuery, status: 'Completed', completedAt: { $exists: true } } },
                {
                    $project: {
                        completionDays: {
                            $divide: [
                                { $subtract: ['$completedAt', '$createdAt'] },
                                1000 * 60 * 60 * 24
                            ]
                        }
                    }
                },
                { $group: { _id: null, avgDays: { $avg: '$completionDays' } } }
            ])
        ]);

        const completionRate = totalTasks > 0
            ? Math.round((completedThisMonth / createdThisMonth) * 100) || 0
            : 0;

        res.json({
            success: true,
            data: {
                totalTasks,
                completedThisMonth,
                createdThisMonth,
                completionRate,
                overdueCount: overdueTasks.length,
                overdueTasks,
                avgCompletionDays: avgCompletionTime[0]?.avgDays?.toFixed(1) || 0
            }
        });
    } catch (error) {
        console.error('Get overview stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch overview statistics',
            error: error.message
        });
    }
};

// @desc    Get stats by employee
// @route   GET /api/tasks/analytics/by-employee
// @access  Manager/Admin
export const getStatsByEmployee = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let matchQuery = { isDeleted: false };

        if (role === 'manager') {
            const user = await User.findById(req.user.id).populate('employee');
            if (user?.employee) {
                const teamIds = await getTeamMemberIds(user.employee._id);
                matchQuery.assignee = { $in: teamIds };
            }
        }

        const employeeStats = await Task.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: '$assignee',
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
                    },
                    inProgressTasks: {
                        $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] }
                    },
                    todoTasks: {
                        $sum: { $cond: [{ $eq: ['$status', 'Todo'] }, 1, 0] }
                    },
                    overdueTasks: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $lt: ['$dueDate', new Date()] },
                                        { $ne: ['$status', 'Completed'] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'employees',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'employee'
                }
            },
            { $unwind: '$employee' },
            {
                $project: {
                    _id: 1,
                    employeeName: { $concat: ['$employee.firstName', ' ', '$employee.lastName'] },
                    employeeEmail: '$employee.email',
                    profileImage: '$employee.profileImage',
                    totalTasks: 1,
                    completedTasks: 1,
                    inProgressTasks: 1,
                    todoTasks: 1,
                    overdueTasks: 1,
                    completionRate: {
                        $round: [
                            { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] },
                            1
                        ]
                    }
                }
            },
            { $sort: { totalTasks: -1 } }
        ]);

        res.json({
            success: true,
            data: employeeStats
        });
    } catch (error) {
        console.error('Get stats by employee error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch employee statistics',
            error: error.message
        });
    }
};

// @desc    Get team members (for task assignment dropdown)
// @route   GET /api/tasks/team-members
// @access  Manager/Admin
export const getTeamMembers = async (req, res) => {
    try {
        const { role } = req.user;

        if (role !== 'admin' && role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        let employees;

        if (role === 'admin') {
            employees = await Employee.find({ status: 'Active' })
                .select('firstName lastName email profileImage department designation')
                .populate('department', 'name')
                .sort({ firstName: 1 });
        } else {
            const user = await User.findById(req.user.id).populate('employee');
            let managerEmployeeId = user?.employee?._id;

            // Fallback: if employee not linked, try to find by email
            if (!managerEmployeeId && req.user.email) {
                const foundManager = await Employee.findOne({ email: req.user.email });
                if (foundManager) {
                    managerEmployeeId = foundManager._id;
                }
            }

            if (managerEmployeeId) {
                const teamIds = await getTeamMemberIds(managerEmployeeId);
                employees = await Employee.find({ _id: { $in: teamIds }, status: 'Active' })
                    .select('firstName lastName email profileImage department designation')
                    .populate('department', 'name')
                    .sort({ firstName: 1 });
            } else {
                employees = [];
            }
        }

        res.json({
            success: true,
            data: employees
        });
    } catch (error) {
        console.error('Get team members error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch team members',
            error: error.message
        });
    }
};
