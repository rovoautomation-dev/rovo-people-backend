import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Department name is required'],
        unique: true,
        trim: true
    },
    code: {
        type: String,
        unique: true,
        uppercase: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    head: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
    },
    parentDepartment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department'
    },
    budget: {
        type: Number,
        default: 0
    },
    location: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    color: {
        type: String,
        default: '#2563eb' // Primary color
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for employee count
departmentSchema.virtual('employeeCount', {
    ref: 'Employee',
    localField: 'name',
    foreignField: 'department',
    count: true
});

// Generate code from name before saving
departmentSchema.pre('save', function (next) {
    if (!this.code && this.name) {
        this.code = this.name.substring(0, 3).toUpperCase();
    }
    next();
});

// Announcement Schema
const announcementSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true
    },
    content: {
        type: String,
        required: [true, 'Content is required']
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Urgent'],
        default: 'Medium'
    },
    type: {
        type: String,
        enum: ['General', 'Policy', 'Event', 'Holiday', 'Emergency'],
        default: 'General'
    },
    targetAudience: {
        type: String,
        enum: ['All', 'Department', 'Role'],
        default: 'All'
    },
    departments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Department'
    }],
    roles: [{
        type: String,
        enum: ['admin', 'manager', 'employee']
    }],
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isPinned: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    attachments: [{
        name: String,
        url: String,
        publicId: String
    }]
}, {
    timestamps: true
});

// Index for active announcements within date range
announcementSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

// Company Settings Schema
const settingsSchema = new mongoose.Schema({
    category: {
        type: String,
        required: true,
        enum: ['company', 'notifications', 'security', 'email', 'attendance', 'leave', 'payroll', 'working_hours']
    },
    settings: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

settingsSchema.index({ category: 1 }, { unique: true });

export const Department = mongoose.model('Department', departmentSchema);
export const Announcement = mongoose.model('Announcement', announcementSchema);
export const Settings = mongoose.model('Settings', settingsSchema);
