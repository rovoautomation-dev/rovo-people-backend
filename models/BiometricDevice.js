import mongoose from 'mongoose';

const biometricDeviceSchema = new mongoose.Schema({
    deviceName: {
        type: String,
        required: [true, 'Device name is required'],
        trim: true
    },
    serialNumber: {
        type: String,
        required: [true, 'Serial number is required'],
        unique: true,
        uppercase: true,
        trim: true
    },
    deviceIp: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'online', 'offline', 'unauthorized', 'communicated'],
        default: 'pending'
    },
    lastOnline: {
        type: Date,
        default: null
    },
    attLogStamp: {
        type: Number,
        default: 0
    },
    opLogStamp: {
        type: Number,
        default: 0
    },
    timezone: {
        type: String,
        default: 'Asia/Kolkata'
    }
}, {
    timestamps: true
});

// biometricDeviceSchema.index({ serialNumber: 1 }, { unique: true });

const BiometricDevice = mongoose.model('BiometricDevice', biometricDeviceSchema);

export default BiometricDevice;
