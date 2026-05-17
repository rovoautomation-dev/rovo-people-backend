import mongoose from 'mongoose';

// ============ SHORT LEAVE CONFIGURATION ============

const shortLeaveConfigSchema = new mongoose.Schema({
    monthlyQuotaMinutes: {
        type: Number,
        default: 240,
        min: 0
    },
    graceMinutes: {
        type: Number,
        default: 15,
        min: 0
    },
    autoDeductOnCheckIn: {
        type: Boolean,
        default: true
    },
    autoDeductOnCheckOut: {
        type: Boolean,
        default: true
    },
    autoHalfDayConversion: {
        type: Boolean,
        default: true
    },
    halfDayThresholdMinutes: {
        type: Number,
        default: 240 // When used minutes exceed this, convert to half day
    },
    requireApproval: {
        type: Boolean,
        default: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Ensure only one config document exists
shortLeaveConfigSchema.index({}, { unique: true });

// ============ SHORT LEAVE MONTHLY RECORD ============

const shortLeaveRecordSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    year: {
        type: Number,
        required: [true, 'Year is required']
    },
    month: {
        type: Number,
        required: [true, 'Month is required'],
        min: 1,
        max: 12
    },
    totalQuotaMinutes: {
        type: Number,
        required: true,
        default: 240
    },
    usedMinutes: {
        type: Number,
        default: 0
    },
    pendingMinutes: {
        type: Number,
        default: 0
    },
    approvedMinutes: {
        type: Number,
        default: 0 // Minutes that were approved (employee marked as Present, not deducted)
    },
    status: {
        type: String,
        enum: ['Active', 'Exhausted', 'Closed'],
        default: 'Active'
    },
    halfDaysConverted: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for remaining minutes
shortLeaveRecordSchema.virtual('remainingMinutes').get(function () {
    return Math.max(0, this.totalQuotaMinutes - this.usedMinutes);
});

// Virtual for total pending + used
shortLeaveRecordSchema.virtual('totalConsumed').get(function () {
    return this.usedMinutes + this.pendingMinutes;
});

// Compound index for unique record per employee per month per year
shortLeaveRecordSchema.index({ employee: 1, year: 1, month: 1 }, { unique: true });

// ============ SHORT LEAVE ENTRY ============

const shortLeaveEntrySchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    date: {
        type: Date,
        required: [true, 'Date is required']
    },
    type: {
        type: String,
        enum: ['Late Arrival', 'Early Departure', 'Manual Request'],
        required: true
    },
    minutesUsed: {
        type: Number,
        required: true,
        min: 1
    },
    reason: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Deducted', 'Converted to Half Day'],
        default: 'Pending'
    },
    requestedAt: {
        type: Date,
        default: Date.now
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    rejectedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        trim: true
    },
    attendance: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Attendance'
    },
    monthlyRecord: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ShortLeaveRecord'
    },
    convertedToHalfDay: {
        type: Boolean,
        default: false
    },
    halfDayApprovedAsPresent: {
        type: Boolean,
        default: false
    },
    halfDayApprovedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    halfDayApprovedAt: {
        type: Date
    },
    managerComment: {
        type: String,
        trim: true
    },
    checkInTime: {
        type: Date
    },
    checkOutTime: {
        type: Date
    },
    expectedTime: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for querying entries
shortLeaveEntrySchema.index({ employee: 1, date: -1 });
shortLeaveEntrySchema.index({ status: 1, date: -1 });
shortLeaveEntrySchema.index({ date: 1 });

// ============ SHORT LEAVE HISTORY ============

const shortLeaveHistorySchema = new mongoose.Schema({
    entry: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ShortLeaveEntry',
        required: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    action: {
        type: String,
        enum: ['Created', 'Approved', 'Rejected', 'Deducted', 'Converted to Half Day', 'Half Day Approved as Present', 'Cancelled'],
        required: true
    },
    previousStatus: {
        type: String
    },
    newStatus: {
        type: String
    },
    minutesAffected: {
        type: Number
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    comment: {
        type: String,
        trim: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: true
});

shortLeaveHistorySchema.index({ entry: 1, createdAt: -1 });
shortLeaveHistorySchema.index({ employee: 1, createdAt: -1 });

export const ShortLeaveConfig = mongoose.model('ShortLeaveConfig', shortLeaveConfigSchema);
export const ShortLeaveRecord = mongoose.model('ShortLeaveRecord', shortLeaveRecordSchema);
export const ShortLeaveEntry = mongoose.model('ShortLeaveEntry', shortLeaveEntrySchema);
export const ShortLeaveHistory = mongoose.model('ShortLeaveHistory', shortLeaveHistorySchema);
