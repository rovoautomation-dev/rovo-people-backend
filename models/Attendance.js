import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    date: {
        type: Date,
        required: [true, 'Date is required']
    },
    checkIn: {
        type: Date
    },
    checkOut: {
        type: Date
    },
    status: {
        type: String,
        enum: ['Present', 'Absent', 'Half Day', 'On Leave', 'Holiday', 'Weekend', 'Missed Punch'],
        default: 'Present'
    },
    missedPunch: {
        type: Boolean,
        default: false
    },
    punchSource: {
        type: String,
        enum: ['biometric', 'manual', 'web', 'mobile'],
        default: 'web'
    },
    workingHours: {
        type: Number,
        default: 0
    },
    overtime: {
        type: Number,
        default: 0
    },
    lateArrival: {
        type: Boolean,
        default: false
    },
    earlyDeparture: {
        type: Boolean,
        default: false
    },
    notes: {
        type: String,
        trim: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number]
        }
    },
    ipAddress: {
        type: String
    },
    device: {
        type: String
    }
}, {
    timestamps: true
});

// Calculate working hours before saving
attendanceSchema.pre('save', async function (next) {
    if (this.checkIn && this.checkOut) {
        const diffMs = this.checkOut - this.checkIn;
        this.workingHours = parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2));

        // Calculate overtime based on working hours configuration
        try {
            const { Settings } = await import('./Organization.js');
            const config = await Settings.findOne({ category: 'working_hours' });
            const workingHoursPerDay = config?.settings?.workingHoursPerDay || 8;

            if (this.workingHours > workingHoursPerDay) {
                this.overtime = parseFloat((this.workingHours - workingHoursPerDay).toFixed(2));
            } else {
                this.overtime = 0;
            }
        } catch (error) {
            console.error('[AttendanceModel] Error fetching working hours config for overtime:', error.message);
            // Fallback to 8 hours
            if (this.workingHours > 8) {
                this.overtime = parseFloat((this.workingHours - 8).toFixed(2));
            } else {
                this.overtime = 0;
            }
        }
    }
    next();
});

// Compound index for unique attendance per employee per day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

// Holiday Schema
const holidaySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Holiday name is required'],
        trim: true
    },
    date: {
        type: Date,
        required: [true, 'Holiday date is required']
    },
    type: {
        type: String,
        enum: ['National', 'Company', 'Optional', 'Public', 'Religious'],
        default: 'National'
    },
    isOptional: {
        type: Boolean,
        default: false
    },
    description: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

holidaySchema.index({ date: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
export const Holiday = mongoose.model('Holiday', holidaySchema);
