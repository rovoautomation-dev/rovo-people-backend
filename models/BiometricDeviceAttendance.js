import mongoose from 'mongoose';

const biometricDeviceAttendanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
    },
    deviceName: {
        type: String,
        required: true
    },
    deviceSerialNumber: {
        type: String,
        required: true,
        uppercase: true
    },
    employeeId: {
        type: String,
        required: true,
        comment: 'Device-side PIN / employee ID from biometric device'
    },
    timestamp: {
        type: Date,
        required: true
    },
    status1: {
        type: Number,
        default: null,
        comment: '0 = Clock In, 1 = Clock Out'
    },
    status2: {
        type: Number,
        default: null
    },
    status3: {
        type: Number,
        default: null
    },
    status4: {
        type: Number,
        default: null
    },
    status5: {
        type: Number,
        default: null
    },
    table: {
        type: String,
        default: ''
    },
    stamp: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicate attendance entries
biometricDeviceAttendanceSchema.index(
    { employeeId: 1, timestamp: 1, deviceSerialNumber: 1 },
    { unique: true }
);

biometricDeviceAttendanceSchema.index({ employee: 1, timestamp: -1 });

const BiometricDeviceAttendance = mongoose.model('BiometricDeviceAttendance', biometricDeviceAttendanceSchema);

export default BiometricDeviceAttendance;
