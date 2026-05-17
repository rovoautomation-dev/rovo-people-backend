import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Recipient is required']
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    type: {
        type: String,
        enum: [
            // Leave notifications
            'leave_request',
            'leave_approved',
            'leave_rejected',
            'leave_cancelled',
            // Task notifications
            'task_assigned',
            'task_updated',
            'task_status_changed',
            'task_comment',
            'task_due_soon',
            // Attendance notifications
            'attendance_checkin',
            'attendance_checkout',
            'attendance_marked',
            'attendance_reminder',
            // Payroll notifications
            'payroll_generated',
            'payroll_processed',
            'payroll_paid',
            'payslip_ready',
            // Short Leave notifications
            'short_leave_request',
            'short_leave_approved',
            'short_leave_rejected',
            // General
            'announcement',
            'general'
        ],
        required: [true, 'Notification type is required']
    },
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true
    },
    message: {
        type: String,
        required: [true, 'Message is required'],
        trim: true
    },
    relatedEntity: {
        entityId: {
            type: mongoose.Schema.Types.ObjectId
        },
        entityType: {
            type: String,
            enum: ['LeaveRequest', 'Attendance', 'Announcement', 'Employee', 'Task', 'Payroll', 'ShortLeave']
        }
    },

    isRead: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for efficient querying
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
