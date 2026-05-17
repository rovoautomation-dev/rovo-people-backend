import mongoose from 'mongoose';

// Leave Type Schema
const leaveTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Leave type name is required'],
        unique: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    daysAllowed: {
        type: Number,
        required: [true, 'Days allowed is required'],
        min: 0
    },
    carryForward: {
        type: Boolean,
        default: false
    },
    maxCarryForward: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isPaid: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Leave Request Schema
const leaveRequestSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    leaveType: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LeaveType',
        required: [true, 'Leave type is required']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required']
    },
    totalDays: {
        type: Number,
        required: true
    },
    reason: {
        type: String,
        required: [true, 'Reason is required'],
        trim: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
        default: 'Pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        trim: true
    },
    isHalfDay: {
        type: Boolean,
        default: false
    },
    halfDayType: {
        type: String,
        enum: ['First Half', 'Second Half'],
    }
}, {
    timestamps: true
});

// Calculate total days before saving
leaveRequestSchema.pre('save', function (next) {
    if (this.isHalfDay) {
        this.totalDays = 0.5;
    } else {
        const start = new Date(this.startDate);
        const end = new Date(this.endDate);
        const diffTime = Math.abs(end - start);
        this.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    next();
});

// Leave Balance Schema
const leaveBalanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    leaveType: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LeaveType',
        required: true
    },
    year: {
        type: Number,
        required: true
    },
    totalAllowed: {
        type: Number,
        required: true
    },
    used: {
        type: Number,
        default: 0
    },
    pending: {
        type: Number,
        default: 0
    },
    carryForward: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Virtual for available balance
leaveBalanceSchema.virtual('available').get(function () {
    return this.totalAllowed + this.carryForward - this.used - this.pending;
});

// Ensure virtuals are included in JSON output
leaveBalanceSchema.set('toJSON', { virtuals: true });
leaveBalanceSchema.set('toObject', { virtuals: true });

// Compound index for unique balance per employee, leave type, and year
leaveBalanceSchema.index({ employee: 1, leaveType: 1, year: 1 }, { unique: true });

export const LeaveType = mongoose.model('LeaveType', leaveTypeSchema);
export const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
export const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);
