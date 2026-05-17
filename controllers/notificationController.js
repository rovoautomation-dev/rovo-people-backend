import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { emitToUsers, emitToRole, emitToManagersAndAdmins } from '../utils/socketHandler.js';
import { sendFCMToDevice } from '../utils/fcmService.js';

// Get notifications for current user
export const getNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly = false, type = '' } = req.query;
        const query = { recipient: req.user._id };

        if (unreadOnly === 'true') {
            query.isRead = false;
        }

        if (type) {
            query.type = type;
        }

        const notifications = await Notification.find(query)
            .populate('sender', 'email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Notification.countDocuments(query);
        const unreadCount = await Notification.countDocuments({
            recipient: req.user._id,
            isRead: false
        });

        res.status(200).json({
            status: 'success',
            data: notifications,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                total,
                unreadCount
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get notifications'
        });
    }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: notification
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to mark notification as read'
        });
    }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user._id, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        res.status(200).json({
            status: 'success',
            message: 'All notifications marked as read'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to mark notifications as read'
        });
    }
};

// Delete a notification
export const deleteNotification = async (req, res) => {
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            recipient: req.user._id
        });

        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete notification'
        });
    }
};

// ============ CORE NOTIFICATION HELPERS ============

/**
 * Create notification and emit real-time event + FCM push notification
 * @param {Object} params - Notification parameters
 * @param {import('express').Application} app - Express app instance (optional, for Socket.IO)
 */
export const createNotification = async ({
    recipient,
    sender,
    type,
    title,
    message,
    relatedEntity
}, app = null) => {
    try {
        const notification = await Notification.create({
            recipient,
            sender,
            type,
            title,
            message,
            relatedEntity
        });

        // Emit real-time notification if Socket.IO is available
        if (app) {
            const io = app.get('io');
            if (io) {
                emitToUsers(io, recipient.toString(), {
                    ...notification.toObject(),
                    _id: notification._id.toString()
                });
            }
        }

        // Send FCM push notification
        try {
            const recipientUser = await User.findById(recipient);
            if (recipientUser && recipientUser.fcmToken) {
                console.log('📲 [FCM] Sending push to user:', recipientUser.email);
                await sendFCMToDevice(
                    recipientUser.fcmToken,
                    { title, body: message },
                    {
                        notificationId: notification._id.toString(),
                        type: type
                    }
                );
            } else {
                console.log('⚠️ [FCM] No FCM token for recipient:', recipient);
            }
        } catch (fcmError) {
            console.error('❌ [FCM] Error sending push:', fcmError.message);
        }

        return notification;
    } catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
};

/**
 * Create notification for multiple recipients
 */
export const createNotificationForMany = async (recipients, notificationData, app = null) => {
    const notifications = [];
    for (const recipientId of recipients) {
        const notification = await createNotification({
            ...notificationData,
            recipient: recipientId
        }, app);
        if (notification) notifications.push(notification);
    }
    return notifications;
};

// ============ LEAVE NOTIFICATION HELPERS ============

// Helper to notify managers/admins about leave requests
export const notifyManagersAboutLeave = async (leaveRequest, employee, sender, app = null) => {
    try {
        let recipients = [];

        // Check if employee has a reporting manager
        if (employee.reportingManager) {
            const managerUser = await User.findOne({
                employee: employee.reportingManager,
                isActive: true
            });

            if (managerUser) {
                recipients.push(managerUser);
            } else {
                const admins = await User.find({ role: 'admin', isActive: true });
                recipients = [...admins];
            }
        } else {
            const admins = await User.find({ role: 'admin', isActive: true });
            recipients = [...admins];
        }

        const notifications = [];
        const uniqueRecipients = [...new Map(recipients.map(item => [item['id'], item])).values()];

        for (const recipient of uniqueRecipients) {
            const notification = await createNotification({
                recipient: recipient._id,
                sender: sender,
                type: 'leave_request',
                title: 'New Leave Request',
                message: `${employee.firstName} ${employee.lastName} has requested ${leaveRequest.totalDays} day(s) of leave from ${new Date(leaveRequest.startDate).toLocaleDateString()} to ${new Date(leaveRequest.endDate).toLocaleDateString()}.`,
                relatedEntity: {
                    entityId: leaveRequest._id,
                    entityType: 'LeaveRequest'
                }
            }, app);
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Failed to notify managers:', error);
        return [];
    }
};

// Helper to notify employee about leave decision
export const notifyEmployeeAboutLeaveDecision = async (leaveRequest, employee, decision, reason = null, app = null) => {
    try {
        const user = await User.findOne({ employee: employee._id });
        if (!user) return null;

        const isApproved = decision === 'approved';
        const notification = await createNotification({
            recipient: user._id,
            type: isApproved ? 'leave_approved' : 'leave_rejected',
            title: `Leave Request ${isApproved ? 'Approved' : 'Rejected'}`,
            message: isApproved
                ? `Your leave request from ${new Date(leaveRequest.startDate).toLocaleDateString()} to ${new Date(leaveRequest.endDate).toLocaleDateString()} has been approved.`
                : `Your leave request from ${new Date(leaveRequest.startDate).toLocaleDateString()} to ${new Date(leaveRequest.endDate).toLocaleDateString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
            relatedEntity: {
                entityId: leaveRequest._id,
                entityType: 'LeaveRequest'
            }
        }, app);
        return notification;
    } catch (error) {
        console.error('Failed to notify employee:', error);
        return null;
    }
};

// ============ TASK NOTIFICATION HELPERS ============

/**
 * Notify about task assignment
 */
export const notifyTaskAssigned = async (task, assignee, assigner, app = null) => {
    try {
        const assigneeUser = await User.findOne({ employee: assignee._id, isActive: true });
        if (!assigneeUser) return null;

        return await createNotification({
            recipient: assigneeUser._id,
            sender: assigner?._id,
            type: 'task_assigned',
            title: 'New Task Assigned',
            message: `You have been assigned a new task: "${task.title}"`,
            relatedEntity: {
                entityId: task._id,
                entityType: 'Task'
            }
        }, app);
    } catch (error) {
        console.error('Failed to notify task assignment:', error);
        return null;
    }
};

/**
 * Notify about task update
 */
export const notifyTaskUpdated = async (task, assignee, updater, app = null) => {
    try {
        const assigneeUser = await User.findOne({ employee: assignee._id, isActive: true });
        if (!assigneeUser || assigneeUser._id.toString() === updater._id.toString()) return null;

        return await createNotification({
            recipient: assigneeUser._id,
            sender: updater._id,
            type: 'task_updated',
            title: 'Task Updated',
            message: `Task "${task.title}" has been updated`,
            relatedEntity: {
                entityId: task._id,
                entityType: 'Task'
            }
        }, app);
    } catch (error) {
        console.error('Failed to notify task update:', error);
        return null;
    }
};

/**
 * Notify about task status change
 */
export const notifyTaskStatusChanged = async (task, oldStatus, newStatus, changedBy, recipientUserIds, app = null) => {
    try {
        const notifications = [];
        for (const userId of recipientUserIds) {
            if (userId.toString() === changedBy._id.toString()) continue;

            const notification = await createNotification({
                recipient: userId,
                sender: changedBy._id,
                type: 'task_status_changed',
                title: 'Task Status Changed',
                message: `Task "${task.title}" status changed from "${oldStatus}" to "${newStatus}"`,
                relatedEntity: {
                    entityId: task._id,
                    entityType: 'Task'
                }
            }, app);
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Failed to notify task status change:', error);
        return [];
    }
};

/**
 * Notify about task comment
 */
export const notifyTaskComment = async (task, comment, commenter, recipientUserIds, app = null) => {
    try {
        const notifications = [];
        for (const userId of recipientUserIds) {
            if (userId.toString() === commenter._id.toString()) continue;

            const notification = await createNotification({
                recipient: userId,
                sender: commenter._id,
                type: 'task_comment',
                title: 'New Comment on Task',
                message: `New comment on task "${task.title}": "${comment.content.substring(0, 50)}${comment.content.length > 50 ? '...' : ''}"`,
                relatedEntity: {
                    entityId: task._id,
                    entityType: 'Task'
                }
            }, app);
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Failed to notify task comment:', error);
        return [];
    }
};

// ============ ATTENDANCE NOTIFICATION HELPERS ============

/**
 * Notify managers about attendance event
 */
export const notifyAttendanceEvent = async (attendance, employee, eventType, app = null) => {
    try {
        const managers = await User.find({
            role: { $in: ['admin', 'manager'] },
            isActive: true
        });

        const eventMessage = eventType === 'checkin'
            ? `${employee.firstName} ${employee.lastName} checked in at ${new Date(attendance.checkIn).toLocaleTimeString()}`
            : `${employee.firstName} ${employee.lastName} checked out at ${new Date(attendance.checkOut).toLocaleTimeString()}`;

        const notifications = [];
        for (const manager of managers) {
            const notification = await createNotification({
                recipient: manager._id,
                type: eventType === 'checkin' ? 'attendance_checkin' : 'attendance_checkout',
                title: eventType === 'checkin' ? 'Employee Check-In' : 'Employee Check-Out',
                message: eventMessage,
                relatedEntity: {
                    entityId: attendance._id,
                    entityType: 'Attendance'
                }
            }, app);
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Failed to notify attendance event:', error);
        return [];
    }
};

// ============ PAYROLL NOTIFICATION HELPERS ============

/**
 * Notify employee about payroll event
 */
export const notifyPayrollEvent = async (payroll, employee, eventType, app = null) => {
    try {
        const employeeUser = await User.findOne({ employee: employee._id, isActive: true });
        if (!employeeUser) return null;

        const messages = {
            'processed': `Your payroll for ${payroll.month}/${payroll.year} has been processed. Net pay: ₹${payroll.netPay?.toLocaleString() || 'N/A'}`,
            'paid': `Your salary for ${payroll.month}/${payroll.year} has been paid. Amount: ₹${payroll.netPay?.toLocaleString() || 'N/A'}`,
            'payslip': `Your payslip for ${payroll.month}/${payroll.year} is now available for download.`
        };

        const types = {
            'processed': 'payroll_processed',
            'paid': 'payroll_paid',
            'payslip': 'payslip_ready'
        };

        const titles = {
            'processed': 'Payroll Processed',
            'paid': 'Salary Paid',
            'payslip': 'Payslip Available'
        };

        return await createNotification({
            recipient: employeeUser._id,
            type: types[eventType],
            title: titles[eventType],
            message: messages[eventType],
            relatedEntity: {
                entityId: payroll._id,
                entityType: 'Payroll'
            }
        }, app);
    } catch (error) {
        console.error('Failed to notify payroll event:', error);
        return null;
    }
};

// ============ SHORT LEAVE NOTIFICATION HELPERS ============

/**
 * Notify managers about short leave request
 */
export const notifyShortLeaveRequest = async (shortLeave, employee, app = null) => {
    try {
        const managers = await User.find({
            role: { $in: ['admin', 'manager'] },
            isActive: true
        });

        const notifications = [];
        for (const manager of managers) {
            const notification = await createNotification({
                recipient: manager._id,
                type: 'short_leave_request',
                title: 'New Short Leave Request',
                message: `${employee.firstName} ${employee.lastName} has requested short leave for ${shortLeave.minutes} minutes on ${new Date(shortLeave.date).toLocaleDateString()}`,
                relatedEntity: {
                    entityId: shortLeave._id,
                    entityType: 'ShortLeave'
                }
            }, app);
            if (notification) notifications.push(notification);
        }
        return notifications;
    } catch (error) {
        console.error('Failed to notify short leave request:', error);
        return [];
    }
};

/**
 * Notify employee about short leave decision
 */
export const notifyShortLeaveDecision = async (shortLeave, employee, decision, reason = null, app = null) => {
    try {
        const employeeUser = await User.findOne({ employee: employee._id, isActive: true });
        if (!employeeUser) return null;

        const isApproved = decision === 'approved';
        return await createNotification({
            recipient: employeeUser._id,
            type: isApproved ? 'short_leave_approved' : 'short_leave_rejected',
            title: `Short Leave ${isApproved ? 'Approved' : 'Rejected'}`,
            message: isApproved
                ? `Your short leave request for ${new Date(shortLeave.date).toLocaleDateString()} has been approved.`
                : `Your short leave request for ${new Date(shortLeave.date).toLocaleDateString()} has been rejected.${reason ? ` Reason: ${reason}` : ''}`,
            relatedEntity: {
                entityId: shortLeave._id,
                entityType: 'ShortLeave'
            }
        }, app);
    } catch (error) {
        console.error('Failed to notify short leave decision:', error);
        return null;
    }
};

