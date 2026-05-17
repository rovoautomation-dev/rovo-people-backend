import mongoose from 'mongoose';

// Hourly location entry schema
const hourlyLocationSchema = new mongoose.Schema({
    hour: {
        type: Number, // 0-23 representing the hour
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    address: {
        type: String,
        trim: true
    },
    timestamp: {
        type: Date,
        required: true
    },
    accuracy: {
        type: Number
    }
});

// Permission disable event schema
const permissionDisableEventSchema = new mongoose.Schema({
    disabledAt: {
        type: Date,
        required: true
    },
    enabledAt: {
        type: Date
    },
    duration: {
        type: Number, // Duration in minutes
        default: 0
    },
    notifiedTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
});

// Main Attendance Location Schema
const attendanceLocationSchema = new mongoose.Schema({
    attendance: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Attendance',
        required: [true, 'Attendance ID is required']
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: [true, 'Employee is required']
    },
    date: {
        type: Date,
        required: true
    },
    // Tracking status
    trackingStatus: {
        type: String,
        enum: ['Active', 'Paused', 'Stopped'],
        default: 'Active'
    },
    trackingStartedAt: {
        type: Date
    },
    trackingStoppedAt: {
        type: Date
    },
    // Hourly location entries (1 per hour)
    locationHistory: [hourlyLocationSchema],
    // Last known location for real-time tracking
    lastLocation: {
        coordinates: {
            type: [Number] // [longitude, latitude]
        },
        address: String,
        timestamp: Date,
        accuracy: Number
    },
    // Total distance traveled (in meters)
    totalDistance: {
        type: Number,
        default: 0
    },
    // Location permission status
    locationPermissionEnabled: {
        type: Boolean,
        default: true
    },
    // History of permission disable events
    permissionDisableHistory: [permissionDisableEventSchema],
    // Device info
    deviceInfo: {
        platform: String, // 'web' or 'mobile'
        deviceName: String,
        appVersion: String
    }
}, {
    timestamps: true
});

// Calculate distance between two points using Haversine formula
attendanceLocationSchema.methods.calculateDistance = function (coord1, coord2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Method to add hourly location update
attendanceLocationSchema.methods.addHourlyLocation = function (coordinates, address, timestamp, accuracy) {
    const hour = new Date(timestamp).getHours();

    // Check if we already have an entry for this hour
    const existingIndex = this.locationHistory.findIndex(entry => entry.hour === hour);

    if (existingIndex >= 0) {
        // Update existing entry for this hour
        this.locationHistory[existingIndex] = {
            hour,
            location: {
                type: 'Point',
                coordinates
            },
            address,
            timestamp,
            accuracy
        };
    } else {
        // Add new entry
        this.locationHistory.push({
            hour,
            location: {
                type: 'Point',
                coordinates
            },
            address,
            timestamp,
            accuracy
        });

        // Sort by hour
        this.locationHistory.sort((a, b) => a.hour - b.hour);
    }

    // Update last location
    this.lastLocation = {
        coordinates,
        address,
        timestamp,
        accuracy
    };

    // Calculate total distance if we have multiple locations
    if (this.locationHistory.length > 1) {
        let totalDist = 0;
        for (let i = 1; i < this.locationHistory.length; i++) {
            const prev = this.locationHistory[i - 1].location.coordinates;
            const curr = this.locationHistory[i].location.coordinates;
            totalDist += this.calculateDistance(prev, curr);
        }
        this.totalDistance = Math.round(totalDist);
    }
};

// Method to record location permission disabled
attendanceLocationSchema.methods.recordPermissionDisabled = function () {
    this.locationPermissionEnabled = false;
    this.permissionDisableHistory.push({
        disabledAt: new Date(),
        notifiedTo: []
    });
};

// Method to record location permission re-enabled
attendanceLocationSchema.methods.recordPermissionEnabled = function () {
    this.locationPermissionEnabled = true;
    const lastEvent = this.permissionDisableHistory[this.permissionDisableHistory.length - 1];
    if (lastEvent && !lastEvent.enabledAt) {
        lastEvent.enabledAt = new Date();
        lastEvent.duration = Math.round((lastEvent.enabledAt - lastEvent.disabledAt) / (1000 * 60));
    }
};

// Indexes
attendanceLocationSchema.index({ attendance: 1 }, { unique: true });
attendanceLocationSchema.index({ employee: 1, date: 1 });
attendanceLocationSchema.index({ 'lastLocation.coordinates': '2dsphere' });
attendanceLocationSchema.index({ trackingStatus: 1 });

const AttendanceLocation = mongoose.model('AttendanceLocation', attendanceLocationSchema);

export default AttendanceLocation;
