import mongoose from 'mongoose';

// ============================================
// Task Activity Schema (for tracking changes)
// ============================================
const taskActivitySchema = new mongoose.Schema({
    task: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        enum: ['created', 'updated', 'status_changed', 'assigned', 'commented', 'attachment_added', 'attachment_removed', 'completed', 'reopened'],
        required: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

// ============================================
// Task Comment Schema
// ============================================
const taskCommentSchema = new mongoose.Schema({
    task: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        type: String,
        required: [true, 'Comment content is required'],
        trim: true,
        maxlength: [5000, 'Comment cannot exceed 5000 characters']
    },
    attachments: [{
        name: String,
        url: String,
        publicId: String,
        fileType: String,
        fileSize: Number
    }],
    mentions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    }],
    isEdited: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// ============================================
// Subtask Schema (embedded in Task)
// ============================================
const subtaskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    isCompleted: {
        type: Boolean,
        default: false
    },
    completedAt: Date,
    completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// ============================================
// Attachment Schema (embedded in Task)
// ============================================
const attachmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    publicId: String,
    fileType: String,
    fileSize: Number,
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
});

// ============================================
// Main Task Schema
// ============================================
const taskSchema = new mongoose.Schema({
    // Basic Information
    title: {
        type: String,
        required: [true, 'Task title is required'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [10000, 'Description cannot exceed 10000 characters']
    },

    // Assignment
    assignee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Assignee is required']
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Status & Priority
    status: {
        type: String,
        enum: ['Todo', 'In Progress', 'In Review', 'Completed', 'Blocked'],
        default: 'Todo'
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Urgent'],
        default: 'Medium'
    },

    // Category & Tags
    category: {
        type: String,
        enum: ['Development', 'Design', 'Testing', 'Documentation', 'Meeting', 'Administrative', 'Other'],
        default: 'Other'
    },
    tags: [{
        type: String,
        trim: true
    }],

    // Dates
    startDate: {
        type: Date
    },
    dueDate: {
        type: Date
    },
    completedAt: {
        type: Date
    },

    // Time Tracking
    estimatedHours: {
        type: Number,
        min: 0,
        default: 0
    },
    actualHours: {
        type: Number,
        min: 0,
        default: 0
    },

    // Attachments
    attachments: [attachmentSchema],

    // Subtasks
    subtasks: [subtaskSchema],

    // Dependencies & Relations
    dependencies: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task'
    }],
    parentTask: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task'
    },

    // Watchers (get notifications)
    watchers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    }],

    // Soft Delete
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: Date,
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ============================================
// Indexes for Performance
// ============================================
taskSchema.index({ assignee: 1, status: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ priority: 1 });
taskSchema.index({ dueDate: 1 });
taskSchema.index({ isDeleted: 1 });
taskSchema.index({ assignee: 1, isDeleted: 1, status: 1 });

taskCommentSchema.index({ task: 1, createdAt: -1 });
taskActivitySchema.index({ task: 1, createdAt: -1 });

// ============================================
// Virtuals
// ============================================

// Calculate subtask progress
taskSchema.virtual('subtaskProgress').get(function () {
    if (!this.subtasks || this.subtasks.length === 0) return null;
    const completed = this.subtasks.filter(s => s.isCompleted).length;
    return {
        completed,
        total: this.subtasks.length,
        percentage: Math.round((completed / this.subtasks.length) * 100)
    };
});

// Check if task is overdue
taskSchema.virtual('isOverdue').get(function () {
    if (!this.dueDate || this.status === 'Completed') return false;
    return new Date() > new Date(this.dueDate);
});

// Days until due
taskSchema.virtual('daysUntilDue').get(function () {
    if (!this.dueDate) return null;
    const now = new Date();
    const due = new Date(this.dueDate);
    const diffTime = due - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// ============================================
// Pre-save Middleware
// ============================================
taskSchema.pre('save', function (next) {
    // Set completedAt when status changes to Completed
    if (this.isModified('status') && this.status === 'Completed' && !this.completedAt) {
        this.completedAt = new Date();
    }
    // Clear completedAt if status changes from Completed
    if (this.isModified('status') && this.status !== 'Completed') {
        this.completedAt = undefined;
    }
    next();
});

// ============================================
// Static Methods
// ============================================

// Get tasks for an employee
taskSchema.statics.getEmployeeTasks = function (employeeId, filters = {}) {
    const query = {
        assignee: employeeId,
        isDeleted: false,
        ...filters
    };
    return this.find(query)
        .populate('assignee', 'firstName lastName email profileImage')
        .populate('createdBy', 'email')
        .sort({ priority: -1, dueDate: 1 });
};

// Get team tasks for a manager
taskSchema.statics.getTeamTasks = function (employeeIds, filters = {}) {
    const query = {
        assignee: { $in: employeeIds },
        isDeleted: false,
        ...filters
    };
    return this.find(query)
        .populate('assignee', 'firstName lastName email profileImage')
        .populate('createdBy', 'email')
        .sort({ priority: -1, dueDate: 1 });
};

// ============================================
// Models
// ============================================
const Task = mongoose.model('Task', taskSchema);
const TaskComment = mongoose.model('TaskComment', taskCommentSchema);
const TaskActivity = mongoose.model('TaskActivity', taskActivitySchema);

export { Task, TaskComment, TaskActivity };
export default Task;
